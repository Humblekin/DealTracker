import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.106.2'
import { corsHeaders, handleCors, methodNotAllowed } from '../_shared/cors.ts'
import { authenticateMerchant, AuthError } from '../_shared/merchant-auth.ts'
import { sendPayout } from '../_shared/moolre-client.ts'
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

    const { transaction_id, merchant_order_id, payout_phone, payout_network } = await req.json()

    if (!transaction_id && !merchant_order_id) {
      return new Response(JSON.stringify({ error: 'transaction_id or merchant_order_id is required' }), { status: 400, headers: cors })
    }

    // Find transaction
    let query = supabase
      .from('merchant_transactions')
      .select('*, deal:deals!deal_id(id, status, amount, net_amount, platform_fee, fee_breakdown, moolre_reference)')
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

    if (transaction.status === 'COMPLETED') {
      return new Response(JSON.stringify({
        error: 'Funds have already been released for this transaction',
      }), { status: 409, headers: cors })
    }

    if (transaction.status !== 'SHIPPED') {
      return new Response(JSON.stringify({
        error: `Cannot release funds. Transaction is in "${transaction.status}" status, expected SHIPPED`,
      }), { status: 400, headers: cors })
    }

    if (!transaction.deal || transaction.deal.status !== 'DELIVERED') {
      return new Response(JSON.stringify({
        error: 'Associated deal is not in DELIVERED status. Confirm shipment first.',
      }), { status: 400, headers: cors })
    }

    // Get merchant's payout info from settings, or use provided values
    const merchantSettings = auth.merchant.settings as Record<string, unknown>
    const phone = payout_phone || (merchantSettings.payout_phone as string) || null
    const network = payout_network || (merchantSettings.payout_network as string) || null

    if (!phone || !network) {
      const message = !phone
        ? 'payout_phone is required (or set payout_phone in merchant settings)'
        : 'payout_network is required (or set payout_network in merchant settings)'
      return new Response(JSON.stringify({ error: message }), { status: 400, headers: cors })
    }

    const payoutAmount = parseFloat(transaction.deal.net_amount || transaction.deal.amount)
    const payoutRef = `MPO-${transaction.deal_id}-${Date.now()}`

    // Check for existing payout in audit logs to prevent double payout
    const { data: existingPayout } = await supabase
      .from('audit_logs')
      .select('id')
      .eq('deal_id', transaction.deal_id)
      .eq('action', 'MERCHANT_FUNDS_RELEASED')
      .limit(1)

    if (existingPayout && existingPayout.length > 0) {
      return new Response(JSON.stringify({
        error: 'Funds have already been released (double payout prevented)',
      }), { status: 409, headers: cors })
    }

    // Process payout via Moolre
    const payoutResult = await sendPayout({
      amount: payoutAmount,
      recipientPhone: phone,
      network,
      narration: `DealGuider payout for order #${transaction.merchant_order_id}`,
      reference: payoutRef,
    })

    if (!payoutResult.success) {
      await supabase.from('audit_logs').insert({
        deal_id: transaction.deal_id,
        action: 'MERCHANT_PAYOUT_FAILED',
        actor_id: null,
        details: {
          merchant_id: auth.merchantId,
          transaction_id: transaction.id,
          error: payoutResult.error,
          reference: payoutRef,
          phone,
          network,
        },
      })

      return new Response(JSON.stringify({
        error: `Payout failed: ${payoutResult.error}`,
        transaction_id: transaction.id,
      }), { status: 502, headers: cors })
    }

    const now = new Date().toISOString()

    // Atomic update to COMPLETED — only if still DELIVERED
    const { data: updatedDeal, error: updateError } = await supabase
      .from('deals')
      .update({ status: 'COMPLETED' })
      .eq('id', transaction.deal_id)
      .eq('status', 'DELIVERED')
      .select('id')
      .single()

    if (updateError || !updatedDeal) {
      await supabase.from('audit_logs').insert({
        deal_id: transaction.deal_id,
        action: 'MERCHANT_RELEASE_RACE_CONDITION',
        actor_id: null,
        details: {
          merchant_id: auth.merchantId,
          transaction_id: transaction.id,
          payout_reference: payoutResult.reference,
          error: 'Deal was not in DELIVERED status',
        },
      })
      return new Response(JSON.stringify({
        error: 'Deal was not in DELIVERED status (concurrent update or already completed)',
      }), { status: 409, headers: cors })
    }

    // Update merchant transaction
    await supabase.from('merchant_transactions')
      .update({ status: 'COMPLETED', delivered_at: now })
      .eq('id', transaction.id)

    // Audit log
    await supabase.from('audit_logs').insert({
      deal_id: transaction.deal_id,
      action: 'MERCHANT_FUNDS_RELEASED',
      actor_id: null,
      details: {
        merchant_id: auth.merchantId,
        transaction_id: transaction.id,
        merchant_order_id: transaction.merchant_order_id,
        payout_reference: payoutResult.reference,
        amount: payoutAmount,
        phone,
        network,
      },
    })

    // Notify merchant via webhook
    if (auth.merchant.webhook_url) {
      await deliverWebhook(
        auth.merchantId,
        auth.merchant.webhook_url,
        auth.merchant.webhook_secret,
        {
          event: 'escrow.completed',
          transaction_id: transaction.id,
          merchant_id: auth.merchantId,
          deal_id: transaction.deal_id,
          merchant_order_id: transaction.merchant_order_id,
          status: 'COMPLETED',
          amount: parseFloat(transaction.amount),
          currency: transaction.currency,
          timestamp: now,
        },
        transaction.id
      )
    }

    return new Response(JSON.stringify({
      success: true,
      transaction_id: transaction.id,
      deal_id: transaction.deal_id,
      merchant_order_id: transaction.merchant_order_id,
      status: 'COMPLETED',
      amount_released: payoutAmount,
      payout_reference: payoutResult.reference,
      message: 'Funds have been released to the merchant.',
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
