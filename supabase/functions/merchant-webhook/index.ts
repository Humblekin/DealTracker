import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.106.2'
import { corsHeaders, handleCors, methodNotAllowed } from '../_shared/cors.ts'
import { verifyPayment } from '../_shared/moolre-client.ts'
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
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    })

    const payload = await req.json()
    const reference = payload.externalref || payload.data?.externalref || payload.data?.reference
    const moolreRef = payload.data?.reference || reference

    if (!reference) {
      return new Response(JSON.stringify({ error: 'Missing reference' }), { status: 400, headers: cors })
    }

    // Check idempotency — find deal by payment_reference
    const { data: deals, error: findError } = await supabase
      .from('deals')
      .select('id, status, buyer_id, seller_id, title, amount')
      .eq('payment_reference', reference)

    if (findError || !deals || deals.length === 0) {
      return new Response(JSON.stringify({ error: 'No deal found for this reference' }), { status: 404, headers: cors })
    }

    const deal = deals[0]

    // Idempotency: skip if already processed
    if (deal.status !== 'AWAITING_PAYMENT') {
      return new Response(JSON.stringify({
        received: true,
        processed: false,
        reason: `Deal is in ${deal.status} status`,
      }), { status: 200, headers: cors })
    }

    // Verify with Moolre API
    const verification = await verifyPayment(reference)

    const paymentSuccessful =
      payload.status === 1 ||
      payload.status === '1' ||
      payload.status === 'success' ||
      payload.status === 'SUCCESS' ||
      verification.success

    if (!paymentSuccessful) {
      return new Response(JSON.stringify({
        received: true,
        processed: false,
        reason: 'Payment not successful',
      }), { status: 200, headers: cors })
    }

    // Atomic update to IN_ESCROW — only if still AWAITING_PAYMENT (prevents race condition)
    const { data: updatedDeal, error: updateError } = await supabase
      .from('deals')
      .update({
        status: 'IN_ESCROW',
        moolre_reference: moolreRef || reference,
      })
      .eq('id', deal.id)
      .eq('status', 'AWAITING_PAYMENT')
      .select('id')
      .single()

    if (updateError || !updatedDeal) {
      return new Response(JSON.stringify({
        received: true, processed: false,
        reason: 'Deal was not in AWAITING_PAYMENT (concurrent update or already processed)',
      }), { status: 200, headers: cors })
    }

    // Record payment
    await supabase.from('payments').insert({
      deal_id: deal.id,
      moolre_reference: moolreRef || reference,
      amount: deal.amount,
      status: 'SUCCESS',
    })

    // Audit log
    await supabase.from('audit_logs').insert({
      deal_id: deal.id,
      action: 'MERCHANT_WEBHOOK_PAYMENT_RECEIVED',
      actor_id: null,
      details: {
        reference,
        moolre_reference: moolreRef || reference,
        webhook_payload: payload,
      },
    })

    // Find the merchant transaction linked to this deal
    const { data: merchantTx } = await supabase
      .from('merchant_transactions')
      .select('id, merchant_id, merchant_order_id, amount, currency, customer_email')
      .eq('deal_id', deal.id)
      .single()

    if (merchantTx) {
      // Update merchant transaction
      await supabase.from('merchant_transactions')
        .update({ status: 'IN_ESCROW' })
        .eq('id', merchantTx.id)

      // Notify merchant via their webhook
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
            amount: parseFloat(deal.amount),
            currency: 'GHS',
            timestamp: new Date().toISOString(),
          },
          merchantTx.id
        )
      }

      // Notify the merchant's customer (via transaction data)
      await supabase.from('notifications').insert({
        user_id: null,
        title: 'Payment Received',
        message: `Payment for order #${merchantTx.merchant_order_id} has been received and is in escrow.`,
        type: 'payment',
        deal_id: deal.id,
      })
    }

    return new Response(JSON.stringify({
      received: true,
      processed: true,
    }), { status: 200, headers: cors })

  } catch (err) {
    return new Response(JSON.stringify({
      error: err instanceof Error ? err.message : 'Internal server error',
    }), { status: 500, headers: cors })
  }
})
