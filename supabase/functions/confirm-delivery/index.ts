// ---------------------------------------------------------------
// Confirm Delivery — triggers Moolre Sandbox Payout
// Buyer confirms delivery, then automatically sends payout to
// seller via the Moolre sandbox API (POST /open/transact/transfer).
// Uses the same sandbox credentials as moolre-payout.
// Falls back to admin notification if auto-payout fails.
// ---------------------------------------------------------------
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.106.2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const MOOLRE_API_USER = Deno.env.get('MOOLRE_API_USER')!
const MOOLRE_PRIVATE_KEY = Deno.env.get('MOOLRE_PRIVATE_KEY')!
const MOOLRE_ACCOUNT_NUMBER = Deno.env.get('MOOLRE_ACCOUNT_NUMBER')!
const MOOLRE_BASE_URL = Deno.env.get('MOOLRE_BASE_URL') || 'https://api.moolre.com'  // Sandbox base URL

const ALLOWED_ORIGINS = [
  'http://localhost:5173',
  'http://localhost:5174',
  'http://localhost:4173',
  'https://dealtracker.vercel.app',
  SUPABASE_URL,
  'http://dealtracke.netlify.app',
  'https://dealtracke.netlify.app',
  'https://dealguider.netlify.app',
]

function corsHeaders(origin: string | null): Record<string, string> {
  const allowed = ALLOWED_ORIGINS.includes(origin || '') ? origin! : ALLOWED_ORIGINS[0]
  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400',
    'Content-Type': 'application/json',
  }
}

const NETWORK_CHANNEL: Record<string, string> = {
  mtn: '1',
  vodafone: '6',
  tigo: '7',
}

async function sendPayout(
  amount: number,
  recipientPhone: string,
  network: string,
  narration: string,
  reference: string
) {
  const channel = NETWORK_CHANNEL[network.toLowerCase()]
  if (!channel) {
    return { success: false, error: `Unsupported network: ${network}` }
  }

  const res = await fetch(`${MOOLRE_BASE_URL}/open/transact/transfer`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-USER': MOOLRE_API_USER,
      'X-API-KEY': MOOLRE_PRIVATE_KEY,
    },
    body: JSON.stringify({
      type: 1,
      channel,
      currency: 'GHS',
      amount: amount.toString(),
      receiver: recipientPhone,
      externalref: reference,
      accountnumber: MOOLRE_ACCOUNT_NUMBER,
      reference: narration,
    }),
  })

  const data = await res.json()

  if (!res.ok || data.status !== '1') {
    return { success: false, error: data.message || data.error || 'Transfer failed' }
  }

  return {
    success: true,
    reference: data.data?.externalref || reference,
  }
}

serve(async (req) => {
  const origin = req.headers.get('Origin')
  const cors = corsHeaders(origin)

  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: cors })
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: cors,
    })
  }

  try {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: cors,
      })
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    })

    const { data: { user }, error: userError } = await supabase.auth.getUser(
      authHeader.replace('Bearer ', '')
    )
    if (userError || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: cors,
      })
    }

    const { deal_id } = await req.json()
    if (!deal_id) {
      return new Response(JSON.stringify({ error: 'deal_id is required' }), {
        status: 400,
        headers: cors,
      })
    }

    const { data: deal, error: dealError } = await supabase
      .from('deals')
      .select('*, seller:profiles!seller_id(*)')
      .eq('id', deal_id)
      .single()

    if (dealError || !deal) {
      return new Response(JSON.stringify({ error: 'Deal not found' }), {
        status: 404,
        headers: cors,
      })
    }

    if (deal.buyer_id !== user.id) {
      return new Response(JSON.stringify({ error: 'Only the buyer can confirm delivery' }), {
        status: 403,
        headers: cors,
      })
    }

    if (deal.status !== 'IN_ESCROW') {
      return new Response(JSON.stringify({ error: `Deal is in "${deal.status}" status, expected IN_ESCROW` }), {
        status: 400,
        headers: cors,
      })
    }

    if (!deal.seller?.phone || !deal.seller?.network) {
      return new Response(JSON.stringify({
        error: 'Seller has not configured payout details. Please contact support.',
      }), {
        status: 400,
        headers: cors,
      })
    }

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
      details: { amount: deal.amount },
    })

    // Prevent double payout: check if funds were already transferred
    const { data: existingPayout } = await supabase
      .from('audit_logs')
      .select('id, details')
      .eq('deal_id', deal_id)
      .eq('action', 'FUNDS_TRANSFERRED')
      .limit(1)

    if (existingPayout && existingPayout.length > 0) {
      await supabase.from('deals').update({ status: 'COMPLETED' }).eq('id', deal_id)
      return new Response(JSON.stringify({
        success: true,
        message: 'Payout was already processed for this deal.',
      }), { status: 200, headers: cors })
    }

    const payoutRef = `ST-PO-${deal_id}-${Date.now()}`
    const payoutResult = await sendPayout(
      parseFloat(deal.amount),
      deal.seller.phone,
      deal.seller.network,
      `DealGuider payout for "${deal.title}"`,
      payoutRef
    )

    if (!payoutResult.success) {
      await supabase.from('audit_logs').insert({
        deal_id,
        action: 'PAYOUT_FAILED',
        actor_id: user.id,
        details: { error: payoutResult.error, reference: payoutRef },
      })

      await supabase.from('notifications').insert({
        user_id: deal.buyer_id,
        title: 'Delivery Confirmed',
        message: `You confirmed delivery. The payout will be processed shortly.`,
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
        message: `Auto-payout failed for deal #${deal_id} (GH₵ ${parseFloat(deal.amount).toFixed(2)}). Manual intervention required.`,
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
      }), {
        status: 200,
        headers: cors,
      })
    }

    await supabase.from('deals').update({ status: 'COMPLETED' }).eq('id', deal_id).eq('status', 'DELIVERED')

    await supabase.from('audit_logs').insert({
      deal_id,
      action: 'FUNDS_TRANSFERRED',
      actor_id: user.id,
      details: { reference: payoutResult.reference, amount: deal.amount },
    })

    await supabase.from('notifications').insert([
      {
        user_id: deal.seller_id,
        title: 'Payment Received!',
        message: `Funds for "${deal.title}" have been sent to your mobile money.`,
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
    }), {
      status: 200,
      headers: cors,
    })

  } catch (err) {
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : 'Internal server error' }), {
      status: 500,
      headers: cors,
    })
  }
})
