import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.106.2'
import { corsHeaders, handleCors, methodNotAllowed } from '../_shared/cors.ts'
import { authenticateMerchant, AuthError, requireMerchantPermission } from '../_shared/merchant-auth.ts'
import { createTransferRecipient, initiateTransfer } from '../_shared/paystack.ts'
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
    requireMerchantPermission(auth, 'release_funds')
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
      .select('*, deal:deals!deal_id(id, status, amount, net_amount, platform_fee, fee_breakdown, paystack_reference)')
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

    const reference = `MPO-${transaction.deal_id}-${Date.now()}`
    const { data: reservation, error: reservationError } = await supabase.rpc('reserve_merchant_payout', {
      p_transaction_id: transaction.id,
      p_payout_reference: reference,
    })
    if (reservationError) throw reservationError
    if (!reservation?.success) {
      return new Response(JSON.stringify({
        error: reservation?.error || 'Funds are already being released or the transaction is not eligible.',
      }), { status: 409, headers: cors })
    }

    // Create recipient + initiate transfer via Paystack
    let recipient
    try {
      recipient = await createTransferRecipient({
        name: `Merchant ${auth.merchant.name} order #${transaction.merchant_order_id}`,
        phone,
        network,
      })
    } catch (error) {
      const { error: finalizeError } = await supabase.rpc('finalize_merchant_payout', {
        p_transaction_id: transaction.id,
        p_payout_reference: reference,
        p_new_payout_status: 'FAILED',
      })
      if (finalizeError) throw finalizeError
      throw error
    }

    if (!recipient.success || !recipient.recipient_code) {
      const { error: finalizeError } = await supabase.rpc('finalize_merchant_payout', {
        p_transaction_id: transaction.id,
        p_payout_reference: reference,
        p_new_payout_status: 'FAILED',
      })
      if (finalizeError) throw finalizeError
      await supabase.from('audit_logs').insert({
        deal_id: transaction.deal_id,
        action: 'MERCHANT_PAYOUT_FAILED',
        actor_id: null,
        details: {
          merchant_id: auth.merchantId,
          transaction_id: transaction.id,
          error: recipient.error,
          reference,
          phone,
          network,
          stage: 'recipient',
        },
      })

      return new Response(JSON.stringify({
        error: `Payout failed: ${recipient.error}`,
        transaction_id: transaction.id,
      }), { status: 502, headers: cors })
    }

    let payoutResult
    try {
      payoutResult = await initiateTransfer({
        amount: payoutAmount,
        recipientCode: recipient.recipient_code,
        reason: `DealGuider payout for order #${transaction.merchant_order_id}`,
        reference,
      })
    } catch (error) {
      const { error: finalizeError } = await supabase.rpc('finalize_merchant_payout', {
        p_transaction_id: transaction.id,
        p_payout_reference: reference,
        p_new_payout_status: 'PENDING_VERIFICATION',
      })
      if (finalizeError) throw finalizeError
      const { error: auditError } = await supabase.from('audit_logs').insert({
        deal_id: transaction.deal_id,
        action: 'MERCHANT_PAYOUT_PENDING_VERIFICATION',
        actor_id: null,
        details: {
          merchant_id: auth.merchantId,
          transaction_id: transaction.id,
          reference,
          error: error instanceof Error ? error.message : 'Transfer outcome is ambiguous',
        },
      })
      if (auditError) throw auditError
      console.error('[merchant-release-funds] Transfer initiation outcome is ambiguous:', error)
      return new Response(JSON.stringify({
        success: true,
        transaction_id: transaction.id,
        deal_id: transaction.deal_id,
        payout_status: 'PENDING_VERIFICATION',
        payout_reference: reference,
        message: 'Transfer status is being verified. Do not retry this payout.',
      }), { status: 202, headers: cors })
    }

    if (!payoutResult.success) {
      const { error: finalizeError } = await supabase.rpc('finalize_merchant_payout', {
        p_transaction_id: transaction.id,
        p_payout_reference: reference,
        p_new_payout_status: 'FAILED',
      })
      if (finalizeError) throw finalizeError
      await supabase.from('audit_logs').insert({
        deal_id: transaction.deal_id,
        action: 'MERCHANT_PAYOUT_FAILED',
        actor_id: null,
        details: {
          merchant_id: auth.merchantId,
          transaction_id: transaction.id,
          error: payoutResult.error,
          reference,
          phone,
          network,
          stage: 'transfer',
        },
      })

      return new Response(JSON.stringify({
        error: `Payout failed: ${payoutResult.error}`,
        transaction_id: transaction.id,
      }), { status: 502, headers: cors })
    }

    const finalStatus = payoutResult.status === 'success' ? 'SUCCESS' : 'PROCESSING'
    const { error: finalizeError } = await supabase.rpc('finalize_merchant_payout', {
      p_transaction_id: transaction.id,
      p_payout_reference: reference,
      p_new_payout_status: finalStatus,
    })
    if (finalizeError) throw finalizeError
    const now = new Date().toISOString()

    // Audit log
    await supabase.from('audit_logs').insert({
      deal_id: transaction.deal_id,
      action: 'MERCHANT_FUNDS_RELEASED',
      actor_id: null,
      details: {
        merchant_id: auth.merchantId,
        transaction_id: transaction.id,
        merchant_order_id: transaction.merchant_order_id,
        payout_reference: payoutResult.reference || reference,
        transfer_code: payoutResult.transfer_code,
        recipient_code: recipient.recipient_code,
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
          event: finalStatus === 'SUCCESS' ? 'escrow.completed' : 'escrow.payout_processing',
          transaction_id: transaction.id,
          merchant_id: auth.merchantId,
          deal_id: transaction.deal_id,
          merchant_order_id: transaction.merchant_order_id,
          status: finalStatus === 'SUCCESS' ? 'COMPLETED' : 'SHIPPED',
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
      status: finalStatus === 'SUCCESS' ? 'COMPLETED' : 'SHIPPED',
      amount_released: finalStatus === 'SUCCESS' ? payoutAmount : null,
      payout_status: finalStatus,
      payout_reference: payoutResult.reference || reference,
      transfer_code: payoutResult.transfer_code,
      message: finalStatus === 'SUCCESS'
        ? 'Funds have been released to the merchant.'
        : 'Transfer request accepted and is being processed by Paystack.',
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
