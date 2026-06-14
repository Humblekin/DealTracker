import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.106.2'
import { corsHeaders, handleCors, methodNotAllowed } from '../_shared/cors.ts'
import { authenticateMerchant, AuthError } from '../_shared/merchant-auth.ts'
import { initPayment } from '../_shared/moolre-client.ts'
import { calculateFees } from '../_shared/fees.ts'
import { deliverWebhook } from '../_shared/webhook.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

serve(async (req) => {
  const origin = req.headers.get('Origin')
  const cors = corsHeaders(origin)

  const corsRes = handleCors(req)
  if (corsRes) return corsRes

  if (req.method !== 'POST') return methodNotAllowed(req)

  try {
    const apiKey = req.headers.get('X-Api-Key')
    if (!apiKey) {
      return new Response(JSON.stringify({ error: 'X-Api-Key header is required' }), { status: 401, headers: cors })
    }

    const auth = await authenticateMerchant(apiKey)
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    })

    const {
      merchant_order_id,
      amount,
      currency = 'GHS',
      customer_email,
      customer_name,
      merchant_customer_id,
      metadata,
      idempotency_key,
    } = await req.json()

    // Validate required fields
    if (!merchant_order_id) {
      return new Response(JSON.stringify({ error: 'merchant_order_id is required' }), { status: 400, headers: cors })
    }
    if (!amount || parseFloat(amount) <= 0 || parseFloat(amount) > 9999999.99) {
      return new Response(JSON.stringify({ error: 'amount must be between 0.01 and 9,999,999.99' }), { status: 400, headers: cors })
    }
    if (!customer_email) {
      return new Response(JSON.stringify({ error: 'customer_email is required for payment initiation' }), { status: 400, headers: cors })
    }

    // Check idempotency
    if (idempotency_key) {
      const { data: existing } = await supabase
        .from('merchant_transactions')
        .select('id, deal_id, status, moolre_payment_url')
        .eq('idempotency_key', idempotency_key)
        .single()

      if (existing) {
        return new Response(JSON.stringify({
          success: true,
          transaction_id: existing.id,
          deal_id: existing.deal_id,
          status: existing.status,
          payment_url: existing.moolre_payment_url,
          duplicate: true,
        }), { headers: cors })
      }
    }

    // Check for duplicate merchant order
    const { data: duplicate } = await supabase
      .from('merchant_transactions')
      .select('id')
      .eq('merchant_id', auth.merchantId)
      .eq('merchant_order_id', merchant_order_id)
      .single()

    if (duplicate) {
      return new Response(JSON.stringify({
        error: `Order ${merchant_order_id} already exists`,
        transaction_id: duplicate.id,
      }), { status: 409, headers: cors })
    }

    const parsedAmount = parseFloat(amount)
    const fees = calculateFees(parsedAmount)

    // Create deal in escrow system (merchant is seller, no buyer yet)
    const shareToken = crypto.randomUUID()
    const { data: deal, error: dealError } = await supabase
      .from('deals')
      .insert({
        title: `Merchant: ${auth.merchant.name} Order #${merchant_order_id}`,
        description: `Escrow for merchant order ${merchant_order_id} on ${auth.merchant.name}`,
        amount: parsedAmount,
        creator_role: 'SELLER',
        seller_id: null, // Merchant may not have a DealGuider profile — handled via merchant_transactions
        status: 'AWAITING_PAYMENT',
        share_token: shareToken,
        net_amount: fees.sellerReceives,
        platform_fee: fees.platformFee,
        fee_breakdown: fees,
      })
      .select()
      .single()

    if (dealError) throw dealError

    // Create merchant transaction
    const { data: transaction, error: txError } = await supabase
      .from('merchant_transactions')
      .insert({
        merchant_id: auth.merchantId,
        deal_id: deal.id,
        merchant_order_id,
        merchant_customer_id: merchant_customer_id || null,
        customer_email,
        customer_name: customer_name || null,
        amount: parsedAmount,
        currency,
        platform_fee: fees.platformFee,
        status: 'AWAITING_PAYMENT',
        idempotency_key: idempotency_key || null,
        metadata: metadata || {},
      })
      .select()
      .single()

    if (txError) throw txError

    // Initiate Moolre payment
    const externalRef = `MG-${deal.id}-${Date.now()}`
    const callbackUrl = `${SUPABASE_URL}/functions/v1/merchant-webhook`
    const redirectUrl = `${SUPABASE_URL}/functions/v1/merchant-webhook`

    const paymentResult = await initPayment({
      amount: parsedAmount.toString(),
      email: customer_email,
      externalRef,
      callbackUrl,
      redirectUrl,
      metadata: {
        merchant_id: auth.merchantId,
        transaction_id: transaction.id,
        deal_id: deal.id,
        merchant_order_id,
      },
    })

    if (!paymentResult.success) {
      // Cleanup: mark transaction as cancelled
      await supabase.from('merchant_transactions')
        .update({ status: 'CANCELLED' })
        .eq('id', transaction.id)

      await supabase.from('deals')
        .update({ status: 'CANCELLED' })
        .eq('id', deal.id)

      return new Response(JSON.stringify({ error: paymentResult.error }), { status: 502, headers: cors })
    }

    // Update transaction with payment URL
    await supabase.from('merchant_transactions')
      .update({
        moolre_payment_url: paymentResult.authorization_url,
        status: 'AWAITING_PAYMENT',
      })
      .eq('id', transaction.id)

    // Update deal with payment reference
    await supabase.from('deals')
      .update({
        payment_reference: externalRef,
        moolre_reference: paymentResult.reference || externalRef,
      })
      .eq('id', deal.id)

    // Audit log
    await supabase.from('audit_logs').insert({
      deal_id: deal.id,
      action: 'MERCHANT_ESCROW_CREATED',
      actor_id: null,
      details: {
        merchant_id: auth.merchantId,
        merchant_name: auth.merchant.name,
        transaction_id: transaction.id,
        merchant_order_id,
        amount: parsedAmount,
        moolre_reference: paymentResult.reference,
      },
    })

    // Notify merchant via webhook
    if (auth.merchant.webhook_url) {
      await deliverWebhook(
        auth.merchantId,
        auth.merchant.webhook_url,
        auth.merchant.webhook_secret,
        {
          event: 'escrow.created',
          transaction_id: transaction.id,
          merchant_id: auth.merchantId,
          deal_id: deal.id,
          merchant_order_id,
          status: 'AWAITING_PAYMENT',
          amount: parsedAmount,
          currency,
          timestamp: new Date().toISOString(),
        },
        transaction.id
      )
    }

    return new Response(JSON.stringify({
      success: true,
      transaction_id: transaction.id,
      deal_id: deal.id,
      status: 'AWAITING_PAYMENT',
      payment_url: paymentResult.authorization_url,
      amount: parsedAmount,
      currency,
      platform_fee: fees.platformFee,
      expires_at: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
    }), { status: 201, headers: cors })

  } catch (err) {
    if (err instanceof AuthError) {
      return new Response(JSON.stringify({ error: err.message }), { status: 401, headers: cors })
    }
    return new Response(JSON.stringify({
      error: err instanceof Error ? err.message : 'Internal server error',
    }), { status: 500, headers: cors })
  }
})
