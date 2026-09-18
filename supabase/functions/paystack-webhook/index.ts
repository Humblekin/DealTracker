// ---------------------------------------------------------------
// Paystack Webhook Handler — SINGLE webhook endpoint registered in
// the Paystack dashboard. Handles consumer deals AND merchant deals.
// Verifies the X-Paystack-Signature (HMAC-SHA512) before processing.
// Events:
//   charge.success  → AWAITING_PAYMENT → IN_ESCROW (escrow funded)
//   charge.pending  → payment_status = PENDING / PROCESSING
//   charge.failed   → payment_status = FAILED
//   charge.abandoned→ payment_status = ABANDONED
//   charge.reversed → payment_status = REVERSED
//   transfer.success/failed → updates recorded payout status
// ---------------------------------------------------------------
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.106.2'
import { corsHeaders, handleCors, methodNotAllowed } from '../_shared/cors.ts'
import { verifyWebhookSignature, fromPesewas } from '../_shared/paystack.ts'
import { deliverWebhook } from '../_shared/webhook.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const PAYSTACK_SECRET_KEY = Deno.env.get('PAYSTACK_SECRET_KEY')!

function ok(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: corsHeaders(null),
  })
}

serve(async (req) => {
  const origin = req.headers.get('Origin')
  const cors = corsHeaders(origin)

  const corsRes = handleCors(req)
  if (corsRes) return corsRes

  if (req.method !== 'POST') return methodNotAllowed(req)

  try {
    // Read raw body for signature verification, then parse
    const rawBody = await req.text()
    const signature = req.headers.get('x-paystack-signature')

    const validSignature = await verifyWebhookSignature(rawBody, signature, PAYSTACK_SECRET_KEY)
    if (!validSignature) {
      return new Response(JSON.stringify({ error: 'Invalid signature' }), { status: 401, headers: cors })
    }

    const payload = JSON.parse(rawBody)
    const event = payload.event as string
    const data = payload.data || {}

    const reference = data.reference as string
    if (!reference) {
      return ok({ received: true, processed: false, reason: 'Missing reference' })
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    })

    // ---- Transfer events (payouts) — record status, no escrow state change
    if (event.startsWith('transfer.')) {
      // Payout references are stored in the FUNDS_TRANSFERRED audit log,
      // not in the incoming-payment reference columns on deals.
      const { data: payoutLog } = await supabase
        .from('audit_logs')
        .select('id, deal_id, details')
        .eq('action', 'FUNDS_TRANSFERRED')
        .eq('details->>reference', reference)
        .maybeSingle()

      if (!payoutLog?.deal_id) {
        return ok({ received: true, processed: false, reason: 'No payout found for this reference' })
      }

      const { data: deal } = await supabase
        .from('deals')
        .select('id, seller_id, buyer_id, title')
        .eq('id', payoutLog.deal_id)
        .single()

      if (!deal) {
        return ok({ received: true, processed: false, reason: 'Payout deal not found' })
      }

      const providerAction = event === 'transfer.success'
        ? 'PAYOUT_CONFIRMED_BY_PROVIDER'
        : 'PAYOUT_REJECTED_BY_PROVIDER'

      const { data: existingConfirmation } = await supabase
        .from('audit_logs')
        .select('id')
        .eq('deal_id', deal.id)
        .eq('action', providerAction)
        .eq('details->>reference', reference)
        .maybeSingle()

      if (existingConfirmation) {
        return ok({ received: true, processed: true, duplicate: true })
      }

      await supabase.from('audit_logs').insert({
        deal_id: deal.id,
        action: providerAction,
        actor_id: null,
        details: { reference, event },
      })

      if (event === 'transfer.success') {
        await supabase.from('notifications').insert({
          user_id: deal.seller_id,
          title: 'Payment Received',
          message: `Your payout for "${deal.title}" has arrived in your mobile money account.`,
          type: 'payment',
          deal_id: deal.id,
        })
      } else {
        await supabase.from('notifications').insert([
          {
            user_id: deal.seller_id,
            title: 'Payout Failed',
            message: `Your payout for "${deal.title}" could not be completed. Please contact support.`,
            type: 'payment',
            deal_id: deal.id,
          },
          {
            user_id: deal.buyer_id,
            title: 'Payout Failed',
            message: `The payout for "${deal.title}" could not be completed. An administrator will review it.`,
            type: 'payment',
            deal_id: deal.id,
          },
        ])
      }

      return ok({ received: true, processed: true })
    }

    // Find deal by either our reference or the Paystack reference
    const { data: deals } = await supabase
      .from('deals')
      .select('id, status, buyer_id, seller_id, title, amount, payment_reference')
      .or(`payment_reference.eq.${reference},paystack_reference.eq.${reference}`)

    if (!deals || deals.length === 0) {
      return ok({ received: true, processed: false, reason: 'No deal found for this reference' })
    }

    const deal = deals[0]

    // ---- Non-success charge events — update payment status only
    if (event !== 'charge.success') {
      const statusMap: Record<string, string> = {
        'charge.pending': 'PENDING',
        'charge.failed': 'FAILED',
        'charge.abandoned': 'ABANDONED',
        'charge.reversed': 'REVERSED',
      }
      const paymentStatus = statusMap[event]

      await supabase.from('deals').update({ payment_status: paymentStatus }).eq('id', deal.id)

      await supabase.from('payments').insert({
        deal_id: deal.id,
        paystack_reference: reference,
        amount: deal.amount,
        status: event === 'charge.reversed' ? 'FAILED' : 'PENDING',
        paystack_status: paymentStatus,
      })

      await supabase.from('audit_logs').insert({
        deal_id: deal.id,
        action: `PAYMENT_${paymentStatus}`,
        actor_id: deal.buyer_id,
        details: { reference, event },
      })

      return ok({ received: true, processed: true })
    }

    // ---- charge.success — fund the escrow (atomic state transition)
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
      return ok({
        received: true, processed: false,
        reason: 'Deal was not in AWAITING_PAYMENT (concurrent update or already processed)',
      })
    }

    const paidAmount = data.amount ? fromPesewas(data.amount) : parseFloat(deal.amount)

    await supabase.from('payments').insert({
      deal_id: deal.id,
      paystack_reference: reference,
      amount: paidAmount,
      status: 'SUCCESS',
      paystack_status: 'SUCCESS',
    })

    await supabase.from('audit_logs').insert({
      deal_id: deal.id,
      action: 'PAYMENT_RECEIVED',
      actor_id: deal.buyer_id,
      details: { reference, event, amount: paidAmount },
    })

    // Check whether this deal belongs to a merchant transaction
    const { data: merchantTx } = await supabase
      .from('merchant_transactions')
      .select('id, merchant_id, merchant_order_id, amount, currency, customer_email')
      .eq('deal_id', deal.id)
      .single()

    if (merchantTx) {
      // ---- Merchant flow
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

      // Notify admins (merchant customers are not DealGuider users)
      const { data: admins } = await supabase
        .from('profiles')
        .select('id')
        .eq('role', 'admin')

      const adminNotifs = (admins || []).map(a => ({
        user_id: a.id,
        title: 'Merchant Payment Received',
        message: `Payment for order #${merchantTx.merchant_order_id} received and held in escrow.`,
        type: 'payment',
        deal_id: deal.id,
      }))

      if (adminNotifs.length > 0) {
        await supabase.from('notifications').insert(adminNotifs)
      }
    } else {
      // ---- Consumer flow — notify buyer & seller
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

    return ok({ received: true, processed: true })

  } catch (err) {
    return new Response(JSON.stringify({
      error: err instanceof Error ? err.message : 'Internal server error',
    }), { status: 500, headers: cors })
  }
})
