// ---------------------------------------------------------------
// Confirm Delivery — triggers Paystack Transfer (payout)
// Buyer confirms delivery, then sends payout to the seller's
// mobile money via the Paystack Transfers API. Recipient codes are
// cached on the seller profile. Falls back to admin notification
// if the auto-payout fails.
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

    const { deal_id } = await req.json()
    if (!deal_id) {
      return new Response(JSON.stringify({ error: 'deal_id is required' }), { status: 400, headers: cors })
    }

    const { data: deal, error: dealError } = await supabase
      .from('deals')
      .select('*, seller:profiles!seller_id(*)')
      .eq('id', deal_id)
      .single()

    if (dealError || !deal) {
      return new Response(JSON.stringify({ error: 'Deal not found' }), { status: 404, headers: cors })
    }

    if (deal.buyer_id !== user.id) {
      return new Response(JSON.stringify({ error: 'Only the buyer can confirm delivery' }), { status: 403, headers: cors })
    }

    if (deal.status !== 'IN_ESCROW') {
      return new Response(JSON.stringify({
        error: `Deal is in "${deal.status}" status, expected IN_ESCROW`,
      }), { status: 400, headers: cors })
    }

    if (!deal.seller?.phone || !deal.seller?.network) {
      return new Response(JSON.stringify({
        error: 'Seller has not configured payout details. Please contact support.',
      }), { status: 400, headers: cors })
    }

    const payoutAmount = parseFloat(deal.net_amount || deal.amount)

    // Atomic status transition: only advance to DELIVERED if still IN_ESCROW
    const { data: deliveredDeal, error: deliverError } = await supabase
      .from('deals')
      .update({ status: 'DELIVERED' })
      .eq('id', deal_id)
      .eq('status', 'IN_ESCROW')
      .select('id')
      .single()

    if (deliverError || !deliveredDeal) {
      return new Response(JSON.stringify({
        error: 'Deal is no longer in IN_ESCROW status (possible concurrent update)',
      }), { status: 409, headers: cors })
    }

    await supabase.from('audit_logs').insert({
      deal_id,
      action: 'DELIVERY_CONFIRMED',
      actor_id: user.id,
      details: { amount: deal.amount, payout_amount: payoutAmount },
    })

    // Prevent double payout: check if funds were already transferred
    const { data: existingPayout } = await supabase
      .from('audit_logs')
      .select('id, details')
      .eq('deal_id', deal_id)
      .in('action', ['FUNDS_TRANSFERRED', 'PAYOUT_TRANSFER_SUCCESS'])
      .limit(1)

    if (existingPayout && existingPayout.length > 0) {
      await supabase.from('deals').update({ status: 'COMPLETED' }).eq('id', deal_id)
      return new Response(JSON.stringify({
        success: true,
        message: 'Payout was already processed for this deal.',
      }), { status: 200, headers: cors })
    }

    // Use cached recipient code if available, otherwise create + cache it
    let recipientCode = deal.seller?.recipient_code || null

    if (!recipientCode) {
      const recipient = await createTransferRecipient({
        name: deal.seller.full_name || `Seller ${deal.seller_id}`,
        phone: deal.seller.phone,
        network: deal.seller.network,
      })

      if (!recipient.success || !recipient.recipient_code) {
        await supabase.from('audit_logs').insert({
          deal_id,
          action: 'PAYOUT_FAILED',
          actor_id: user.id,
          details: { error: recipient.error, stage: 'recipient' },
        })

        await supabase.from('notifications').insert({
          user_id: deal.buyer_id,
          title: 'Delivery Confirmed',
          message: 'You confirmed delivery. The payout will be processed shortly.',
          type: 'info',
          deal_id,
        })

        const { data: admins } = await supabase
          .from('profiles')
          .select('id')
          .eq('role', 'admin')

        const adminNotifs = (admins || []).map(a => ({
          user_id: a.id,
          title: 'Payout Failed',
          message: `Auto-payout failed for deal #${deal_id} (GH₵ ${payoutAmount.toFixed(2)}). Manual intervention required.`,
          type: 'payment',
          deal_id,
        }))

        if (adminNotifs.length > 0) {
          await supabase.from('notifications').insert(adminNotifs)
        }

        return new Response(JSON.stringify({
          success: true,
          awaiting_admin: true,
          message: 'Delivery confirmed! Payout will be processed shortly.',
        }), { status: 200, headers: cors })
      }

      recipientCode = recipient.recipient_code

      await supabase.from('profiles')
        .update({ recipient_code: recipient.recipient_code })
        .eq('id', deal.seller_id)
    }

    const payoutRef = `ST-PO-${deal_id}-${Date.now()}`
    const transfer = await initiateTransfer({
      amount: payoutAmount,
      recipientCode,
      reason: `DealGuider payout for "${deal.title}"`,
      reference: payoutRef,
    })

    if (!transfer.success) {
      await supabase.from('audit_logs').insert({
        deal_id,
        action: 'PAYOUT_FAILED',
        actor_id: user.id,
        details: { error: transfer.error, reference: payoutRef },
      })

      await supabase.from('notifications').insert({
        user_id: deal.buyer_id,
        title: 'Delivery Confirmed',
        message: 'You confirmed delivery. The payout will be processed shortly.',
        type: 'info',
        deal_id,
      })

      const { data: admins } = await supabase
        .from('profiles')
        .select('id')
        .eq('role', 'admin')

      const adminNotifs = (admins || []).map(a => ({
        user_id: a.id,
        title: 'Payout Failed',
        message: `Auto-payout failed for deal #${deal_id} (GH₵ ${payoutAmount.toFixed(2)}). Manual intervention required.`,
        type: 'payment',
        deal_id,
      }))

      if (adminNotifs.length > 0) {
        await supabase.from('notifications').insert(adminNotifs)
      }

      return new Response(JSON.stringify({
        success: true,
        awaiting_admin: true,
        message: 'Delivery confirmed! Payout will be processed shortly.',
      }), { status: 200, headers: cors })
    }

    await supabase.from('deals').update({ status: 'COMPLETED' }).eq('id', deal_id).eq('status', 'DELIVERED')

    await supabase.from('audit_logs').insert({
      deal_id,
      action: 'FUNDS_TRANSFERRED',
      actor_id: user.id,
      details: {
        reference: transfer.reference || payoutRef,
        transfer_code: transfer.transfer_code,
        amount: payoutAmount,
        recipient_code: recipientCode,
      },
    })

    await supabase.from('notifications').insert([
      {
        user_id: deal.seller_id,
        title: 'Payout Initiated',
        message: `Your payout for "${deal.title}" has been initiated and is being processed by Paystack.`,
        type: 'payment',
        deal_id,
      },
      {
        user_id: deal.buyer_id,
        title: 'Deal Completed',
        message: `The deal "${deal.title}" is complete. Thank you for using DealGuider!`,
        type: 'info',
        deal_id,
      },
    ])

    return new Response(JSON.stringify({
      success: true,
      message: 'Delivery confirmed! Payment has been sent to the seller.',
    }), { status: 200, headers: cors })

  } catch (err) {
    return new Response(JSON.stringify({
      error: err instanceof Error ? err.message : 'Internal server error',
    }), { status: 500, headers: cors })
  }
})
