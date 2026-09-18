// ---------------------------------------------------------------
// Paystack Verify — authenticated endpoint for the frontend
// "Check Payment Status" action. Queries Paystack for the
// authoritative transaction status and advances the escrow if the
// charge succeeded (idempotent — only advances from AWAITING_PAYMENT).
// ---------------------------------------------------------------
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.106.2'
import { corsHeaders, handleCors, methodNotAllowed } from '../_shared/cors.ts'
import { verifyPayment, fromPesewas } from '../_shared/paystack.ts'
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
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: cors })
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    })

    const { data: { user }, error: userError } = await supabase.auth.getUser(
      authHeader.replace('Bearer ', '')
    )
    if (userError || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: cors })
    }

    const { deal_id } = await req.json()
    if (!deal_id) {
      return new Response(JSON.stringify({ error: 'deal_id is required' }), { status: 400, headers: cors })
    }

    const { data: deal, error: dealError } = await supabase
      .from('deals')
      .select('id, status, payment_status, buyer_id, seller_id, title, amount, payment_reference, paystack_reference')
      .eq('id', deal_id)
      .single()

    if (dealError || !deal) {
      return new Response(JSON.stringify({ error: 'Deal not found' }), { status: 404, headers: cors })
    }

    if (deal.buyer_id !== user.id && deal.seller_id !== user.id) {
      return new Response(JSON.stringify({ error: 'You are not a party to this deal' }), { status: 403, headers: cors })
    }

    // Already funded — nothing to do
    if (deal.status !== 'AWAITING_PAYMENT') {
      return new Response(JSON.stringify({
        success: true,
        status: deal.status,
        payment_status: deal.payment_status,
        payment_confirmed: ['IN_ESCROW', 'DELIVERED', 'COMPLETED'].includes(deal.status),
        message: 'Deal is not awaiting payment.',
      }), { status: 200, headers: cors })
    }

    const references = [deal.paystack_reference, deal.payment_reference]
      .filter((value, index, all): value is string => Boolean(value) && all.indexOf(value) === index)
    if (references.length === 0) {
      return new Response(JSON.stringify({
        success: true,
        status: deal.status,
        payment_status: deal.payment_status,
        message: 'No payment was initialized for this deal yet.',
      }), { status: 200, headers: cors })
    }

    let reference = references[0]
    let verification = await verifyPayment(reference)

    // The provider can return a transient status immediately after checkout.
    // Give the transaction a short settling window before reporting it as pending.
    for (let attempt = 1; !verification.success && attempt < 3; attempt += 1) {
      if (verification.status && !['pending', 'ongoing', 'processing'].includes(verification.status)) break
      await new Promise((resolve) => setTimeout(resolve, 1500))
      verification = await verifyPayment(reference)
    }

    // Older deals may have different values in the two reference columns.
    if (!verification.success && references.length > 1 && verification.status !== 'success') {
      reference = references[1]
      verification = await verifyPayment(reference)
    }

    if (!verification.success) {
      // Record the provider status on the deal without changing escrow state
      await supabase.from('deals').update({ payment_status: verification.status || 'PENDING' }).eq('id', deal.id)

      await supabase.from('audit_logs').insert({
        deal_id: deal.id,
        action: 'PAYMENT_VERIFY_UNCONFIRMED',
        actor_id: user.id,
        details: { reference, status: verification.status, error: verification.error },
      })

      return new Response(JSON.stringify({
        success: true,
        status: deal.status,
        payment_status: verification.status || 'PENDING',
        payment_confirmed: false,
        message: verification.error || 'Payment has not been completed yet.',
      }), { status: 200, headers: cors })
    }

    // Payment confirmed — atomic advance to IN_ESCROW
    const { data: updatedDeal, error: updateError } = await supabase
      .from('deals')
      .update({
        status: 'IN_ESCROW',
        paystack_reference: reference,
        payment_status: 'SUCCESS',
      })
      .eq('id', deal.id)
      .eq('status', 'AWAITING_PAYMENT')
      .select('id')
      .single()

    if (updateError || !updatedDeal) {
      return new Response(JSON.stringify({
        success: true,
        status: deal.status,
        payment_confirmed: false,
        message: 'Payment already processed by another request.',
      }), { status: 200, headers: cors })
    }

    const paidAmount = verification.amount ? fromPesewas(verification.amount) : parseFloat(deal.amount)

    await supabase.from('payments').insert({
      deal_id: deal.id,
      paystack_reference: reference,
      amount: paidAmount,
      status: 'SUCCESS',
      paystack_status: 'SUCCESS',
    })

    await supabase.from('audit_logs').insert({
      deal_id: deal.id,
      action: 'PAYMENT_VERIFIED',
      actor_id: user.id,
      details: { reference, status: 'SUCCESS', amount: paidAmount },
    })

    // Check merchant flow
    const { data: merchantTx } = await supabase
      .from('merchant_transactions')
      .select('id, merchant_id, merchant_order_id, amount, currency, customer_email')
      .eq('deal_id', deal.id)
      .single()

    if (merchantTx) {
      await supabase.from('merchant_transactions')
        .update({ status: 'IN_ESCROW', paystack_reference: reference })
        .eq('id', merchantTx.id)

      const { data: merchant } = await supabase
        .from('merchants')
        .select('webhook_url, webhook_secret')
        .eq('id', merchantTx.merchant_id)
        .single()

      if (merchant?.webhook_url) {
        await deliverWebhook(
          merchantTx.merchant_id,
          merchant.webhook_url,
          merchant.webhook_secret,
          {
            event: 'escrow.funded',
            transaction_id: merchantTx.id,
            merchant_id: merchantTx.merchant_id,
            deal_id: deal.id,
            merchant_order_id: merchantTx.merchant_order_id,
            status: 'IN_ESCROW',
            amount: parseFloat(merchantTx.amount),
            currency: merchantTx.currency || 'GHS',
            timestamp: new Date().toISOString(),
          },
          merchantTx.id
        )
      }
    } else if (deal.seller_id && deal.buyer_id) {
      await supabase.from('notifications').insert([
        {
          user_id: deal.seller_id,
          title: 'Payment Received',
          message: `Payment for "${deal.title}" received. Funds are in escrow. Please deliver the item.`,
          type: 'payment',
          deal_id: deal.id,
        },
        {
          user_id: deal.buyer_id,
          title: 'Payment Confirmed',
          message: `Your payment for "${deal.title}" is now in escrow. Confirm delivery when you receive the item.`,
          type: 'payment',
          deal_id: deal.id,
        },
      ])
    }

    return new Response(JSON.stringify({
      success: true,
      status: 'IN_ESCROW',
      payment_status: 'SUCCESS',
      payment_confirmed: true,
      message: 'Payment confirmed! Funds are now in escrow.',
    }), { status: 200, headers: cors })

  } catch (err) {
    return new Response(JSON.stringify({
      error: err instanceof Error ? err.message : 'Internal server error',
    }), { status: 500, headers: cors })
  }
})
