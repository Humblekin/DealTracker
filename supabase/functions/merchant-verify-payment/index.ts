import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.106.2'
import { corsHeaders, handleCors, methodNotAllowed } from '../_shared/cors.ts'
import { authenticateMerchant, AuthError } from '../_shared/merchant-auth.ts'
import { verifyPayment } from '../_shared/moolre-client.ts'

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

    const { transaction_id, merchant_order_id } = await req.json()

    if (!transaction_id && !merchant_order_id) {
      return new Response(JSON.stringify({ error: 'transaction_id or merchant_order_id is required' }), { status: 400, headers: cors })
    }

    // Find transaction
    let query = supabase
      .from('merchant_transactions')
      .select('*, deal:deals!deal_id(id, status, payment_reference, moolre_reference, amount)')
      .eq('merchant_id', auth.merchantId)

    if (transaction_id) {
      query = query.eq('id', transaction_id)
    } else {
      query = query.eq('merchant_order_id', merchant_order_id)
    }

    const { data: transaction, error: txError } = await query.single()

    if (txError || !transaction) {
      return new Response(JSON.stringify({ error: 'Transaction not found' }), { status: 404, headers: cors })
    }

    // If already in escrow or beyond, return current status
    if (transaction.status !== 'AWAITING_PAYMENT') {
      return new Response(JSON.stringify({
        success: true,
        transaction_id: transaction.id,
        deal_id: transaction.deal_id,
        merchant_order_id: transaction.merchant_order_id,
        status: transaction.status,
        amount: parseFloat(transaction.amount),
        currency: transaction.currency,
        customer_email: transaction.customer_email,
        moolre_payment_url: transaction.moolre_payment_url,
      }), { headers: cors })
    }

    // Verify with Moolre
    const moolreRef = transaction.deal?.moolre_reference || transaction.deal?.payment_reference
    if (!moolreRef) {
      return new Response(JSON.stringify({
        success: true,
        transaction_id: transaction.id,
        status: transaction.status,
        message: 'No payment reference available. Payment may not have been initiated.',
      }), { headers: cors })
    }

    const verification = await verifyPayment(moolreRef)

    if (verification.success) {
      // Payment confirmed — atomic update to IN_ESCROW
      const deal = transaction.deal
      if (deal && deal.status === 'AWAITING_PAYMENT') {
        const { data: updatedDeal, error: updateError } = await supabase
          .from('deals')
          .update({ status: 'IN_ESCROW' })
          .eq('id', deal.id)
          .eq('status', 'AWAITING_PAYMENT')
          .select('id')
          .single()

        if (updateError || !updatedDeal) {
          // Deal was already updated by concurrent request
          return new Response(JSON.stringify({
            success: true,
            transaction_id: transaction.id,
            deal_id: transaction.deal_id,
            merchant_order_id: transaction.merchant_order_id,
            status: transaction.status,
            amount: parseFloat(transaction.amount),
            currency: transaction.currency,
            payment_confirmed: false,
            message: 'Payment already processed by another request.',
          }), { headers: cors })
        }

        await supabase.from('merchant_transactions')
          .update({ status: 'IN_ESCROW' })
          .eq('id', transaction.id)

        await supabase.from('payments').insert({
          deal_id: deal.id,
          moolre_reference: moolreRef,
          amount: parseFloat(deal.amount),
          status: 'SUCCESS',
        })

        await supabase.from('audit_logs').insert({
          deal_id: deal.id,
          action: 'MERCHANT_PAYMENT_VERIFIED',
          actor_id: null,
          details: {
            merchant_id: auth.merchantId,
            transaction_id: transaction.id,
            method: 'verify-payment',
          },
        })
      }

      return new Response(JSON.stringify({
        success: true,
        transaction_id: transaction.id,
        deal_id: transaction.deal_id,
        merchant_order_id: transaction.merchant_order_id,
        status: 'IN_ESCROW',
        amount: parseFloat(transaction.amount),
        currency: transaction.currency,
        payment_confirmed: true,
      }), { headers: cors })
    }

    // Payment not yet completed
    return new Response(JSON.stringify({
      success: true,
      transaction_id: transaction.id,
      deal_id: transaction.deal_id,
      merchant_order_id: transaction.merchant_order_id,
      status: transaction.status,
      amount: parseFloat(transaction.amount),
      currency: transaction.currency,
      payment_confirmed: false,
      moolre_payment_url: transaction.moolre_payment_url,
      message: 'Payment has not been completed yet.',
    }), { headers: cors })

  } catch (err) {
    if (err instanceof AuthError) {
      return new Response(JSON.stringify({ error: err.message }), { status: 401, headers: cors })
    }
    return new Response(JSON.stringify({
      error: err instanceof Error ? err.message : 'Internal server error',
    }), { status: 500, headers: cors })
  }
})
