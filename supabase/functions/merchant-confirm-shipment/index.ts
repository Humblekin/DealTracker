import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.106.2'
import { corsHeaders, handleCors, methodNotAllowed } from '../_shared/cors.ts'
import { authenticateMerchant, AuthError } from '../_shared/merchant-auth.ts'
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

    const { transaction_id, merchant_order_id } = await req.json()

    if (!transaction_id && !merchant_order_id) {
      return new Response(JSON.stringify({ error: 'transaction_id or merchant_order_id is required' }), { status: 400, headers: cors })
    }

    // Find transaction
    let query = supabase
      .from('merchant_transactions')
      .select('*, deal:deals!deal_id(id, status, amount, moolre_reference, payment_reference)')
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

    if (transaction.status !== 'IN_ESCROW') {
      return new Response(JSON.stringify({
        error: `Cannot confirm shipment. Transaction is in "${transaction.status}" status, expected IN_ESCROW`,
      }), { status: 400, headers: cors })
    }

    if (!transaction.deal || transaction.deal.status !== 'IN_ESCROW') {
      return new Response(JSON.stringify({
        error: 'Associated deal is not in escrow status',
      }), { status: 400, headers: cors })
    }

    // Prevent double shipment
    if (transaction.status === 'SHIPPED' || transaction.deal.status === 'DELIVERED') {
      return new Response(JSON.stringify({
        error: 'Shipment has already been confirmed for this transaction',
      }), { status: 409, headers: cors })
    }

    const now = new Date().toISOString()

    // Atomic update to DELIVERED — only if still IN_ESCROW
    const { data: updatedDeal, error: updateError } = await supabase
      .from('deals')
      .update({ status: 'DELIVERED' })
      .eq('id', transaction.deal_id)
      .eq('status', 'IN_ESCROW')
      .select('id')
      .single()

    if (updateError || !updatedDeal) {
      return new Response(JSON.stringify({
        error: 'Deal was not in IN_ESCROW (concurrent update or already shipped)',
      }), { status: 409, headers: cors })
    }

    // Update merchant transaction
    await supabase.from('merchant_transactions')
      .update({ status: 'SHIPPED', shipped_at: now })
      .eq('id', transaction.id)

    // Audit log
    await supabase.from('audit_logs').insert({
      deal_id: transaction.deal_id,
      action: 'MERCHANT_SHIPMENT_CONFIRMED',
      actor_id: null,
      details: {
        merchant_id: auth.merchantId,
        transaction_id: transaction.id,
        merchant_order_id: transaction.merchant_order_id,
        shipped_at: now,
      },
    })

    // Notify merchant via webhook
    if (auth.merchant.webhook_url) {
      await deliverWebhook(
        auth.merchantId,
        auth.merchant.webhook_url,
        auth.merchant.webhook_secret,
        {
          event: 'escrow.shipped',
          transaction_id: transaction.id,
          merchant_id: auth.merchantId,
          deal_id: transaction.deal_id,
          merchant_order_id: transaction.merchant_order_id,
          status: 'SHIPPED',
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
      status: 'SHIPPED',
      shipped_at: now,
      message: 'Shipment confirmed. Awaiting delivery confirmation to release funds.',
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
