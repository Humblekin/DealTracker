// ---------------------------------------------------------------
// Paystack Admin Payout
// Admin-only function to manually trigger a payout via the Paystack
// Transfers API (mobile money recipient + transfer from balance).
// Prevents double payouts via the immutable audit log.
// ---------------------------------------------------------------
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.106.2'
import { corsHeaders, handleCors, methodNotAllowed } from '../_shared/cors.ts'
import { createTransferRecipient, initiateTransfer } from '../_shared/paystack.ts'

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

    const { data: caller } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single()

    if (caller?.role !== 'admin') {
      return new Response(JSON.stringify({ error: 'Only admins can manually trigger payouts' }), { status: 403, headers: cors })
    }

    const { deal_id, amount, phone, network, narration } = await req.json()
    if (!deal_id || !amount || !phone || !network) {
      return new Response(JSON.stringify({ error: 'deal_id, amount, phone, and network are required' }), {
        status: 400,
        headers: cors,
      })
    }

    // Validate deal exists and is in a payout-eligible state
    const { data: deal, error: dealError } = await supabase
      .from('deals')
      .select('id, status, amount, net_amount, seller_id, buyer_id, title')
      .eq('id', deal_id)
      .single()

    if (dealError || !deal) {
      return new Response(JSON.stringify({ error: 'Deal not found' }), { status: 404, headers: cors })
    }

    if (!['IN_ESCROW', 'DELIVERED', 'COMPLETED', 'DISPUTED'].includes(deal.status)) {
      return new Response(JSON.stringify({
        error: `Cannot pay out. Deal is in "${deal.status}" status. Expected IN_ESCROW, DELIVERED, COMPLETED, or DISPUTED.`,
      }), { status: 400, headers: cors })
    }

    // Validate amount matches deal
    const validatedAmount = parseFloat(amount)
    const dealAmount = parseFloat(deal.net_amount || deal.amount)
    if (Math.abs(validatedAmount - dealAmount) > 0.01) {
      return new Response(JSON.stringify({
        error: `Amount ${validatedAmount.toFixed(2)} does not match deal amount ${dealAmount.toFixed(2)}`,
      }), { status: 400, headers: cors })
    }

    // Prevent double payout
    const { data: existingPayout } = await supabase
      .from('audit_logs')
      .select('id')
      .eq('deal_id', deal_id)
      .in('action', ['FUNDS_TRANSFERRED', 'PAYOUT_SENT', 'MERCHANT_FUNDS_RELEASED', 'PAYOUT_TRANSFER_SUCCESS'])
      .limit(1)

    if (existingPayout && existingPayout.length > 0) {
      return new Response(JSON.stringify({
        error: 'A payout has already been processed for this deal (double payout prevented)',
      }), { status: 409, headers: cors })
    }

    const reference = `PO-${deal_id}-${Date.now()}`

    // Create recipient and initiate the transfer
    const recipient = await createTransferRecipient({
      name: `DealGuider payout for ${deal_id}`,
      phone,
      network,
    })

    if (!recipient.success || !recipient.recipient_code) {
      await supabase.from('audit_logs').insert({
        deal_id,
        action: 'ADMIN_PAYOUT_FAILED',
        actor_id: user.id,
        details: { error: recipient.error, reference, amount, phone, network, stage: 'recipient' },
      })
      return new Response(JSON.stringify({ error: recipient.error }), { status: 502, headers: cors })
    }

    const transfer = await initiateTransfer({
      amount: validatedAmount,
      recipientCode: recipient.recipient_code,
      reason: narration || 'DealGuider payout',
      reference,
    })

    if (!transfer.success) {
      await supabase.from('audit_logs').insert({
        deal_id,
        action: 'ADMIN_PAYOUT_FAILED',
        actor_id: user.id,
        details: { error: transfer.error, reference, amount, phone, network, stage: 'transfer' },
      })
      return new Response(JSON.stringify({ error: transfer.error }), { status: 502, headers: cors })
    }

    await supabase.from('deals').update({ status: 'COMPLETED' }).eq('id', deal_id)

    await supabase.from('disputes')
      .update({ status: 'RESOLVED', admin_decision: 'Released to seller' })
      .eq('deal_id', deal_id)
      .eq('status', 'OPEN')

    await supabase.from('audit_logs').insert({
      deal_id,
      action: 'PAYOUT_SENT',
      actor_id: user.id,
      details: {
        reference: transfer.reference || reference,
        transfer_code: transfer.transfer_code,
        recipient_code: recipient.recipient_code,
        amount,
        phone,
        network,
      },
    })

    const notifs: Array<{
      user_id: string
      title: string
      message: string
      type: string
      deal_id: string
    }> = []
    if (deal.seller_id) {
      notifs.push({
        user_id: deal.seller_id,
        title: 'Payment Sent!',
        message: `Funds for "${deal.title}" have been sent.`,
        type: 'payment',
        deal_id,
      })
    }
    if (deal.buyer_id) {
      notifs.push({
        user_id: deal.buyer_id,
        title: 'Deal Complete',
        message: `"${deal.title}" is complete. Your funds have been released to the seller.`,
        type: 'info',
        deal_id,
      })
    }
    if (notifs.length > 0) {
      await supabase.from('notifications').insert(notifs)
    }

    return new Response(JSON.stringify({
      success: true,
      reference: transfer.reference || reference,
      transfer_code: transfer.transfer_code,
    }), { status: 200, headers: cors })

  } catch (err) {
    return new Response(JSON.stringify({
      error: err instanceof Error ? err.message : 'Internal server error',
    }), { status: 500, headers: cors })
  }
})
