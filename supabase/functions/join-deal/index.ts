import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.106.2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

const ALLOWED_ORIGINS = [
  'http://localhost:5173',
  'http://localhost:5174',
  'http://localhost:4173',
  'https://dealtracker.vercel.app',
  SUPABASE_URL,
]

function corsHeaders(origin: string | null): Record<string, string> {
  const allowed = ALLOWED_ORIGINS.includes(origin || '') ? origin! : ALLOWED_ORIGINS[2]
  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400',
    'Content-Type': 'application/json',
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

    const { share_token } = await req.json()
    if (!share_token) {
      return new Response(JSON.stringify({ error: 'share_token is required' }), {
        status: 400,
        headers: cors,
      })
    }

    const { data: deal, error: dealError } = await supabase
      .from('deals')
      .select('*')
      .eq('share_token', share_token)
      .single()

    if (dealError || !deal) {
      return new Response(JSON.stringify({ error: 'Deal not found' }), {
        status: 404,
        headers: cors,
      })
    }

    if (deal.status !== 'AWAITING_COUNTERPARTY') {
      return new Response(JSON.stringify({ error: 'This deal is no longer accepting participants' }), {
        status: 400,
        headers: cors,
      })
    }

    const counterpartyFilled = deal.creator_role === 'BUYER' ? !!deal.seller_id : !!deal.buyer_id
    if (counterpartyFilled) {
      return new Response(JSON.stringify({ error: 'A counterparty has already joined this deal' }), {
        status: 400,
        headers: cors,
      })
    }

    if (deal.buyer_id === user.id || deal.seller_id === user.id) {
      return new Response(JSON.stringify({ error: 'You are already part of this deal' }), {
        status: 400,
        headers: cors,
      })
    }

    const updateData = deal.creator_role === 'BUYER'
      ? { seller_id: user.id, status: 'AWAITING_PAYMENT' }
      : { buyer_id: user.id, status: 'AWAITING_PAYMENT' }

    const { error: updateError } = await supabase
      .from('deals')
      .update(updateData)
      .eq('id', deal.id)

    if (updateError) {
      throw new Error('Failed to join deal')
    }

    await supabase.from('audit_logs').insert({
      deal_id: deal.id,
      action: 'COUNTERPARTY_JOINED',
      actor_id: user.id,
      details: { role: deal.creator_role === 'BUYER' ? 'SELLER' : 'BUYER' },
    })

    await supabase.from('notifications').insert({
      user_id: deal.creator_role === 'BUYER' ? deal.buyer_id : deal.seller_id,
      title: 'Counterparty Joined',
      message: `A ${deal.creator_role === 'BUYER' ? 'seller' : 'buyer'} has joined your deal "${deal.title}"`,
      type: 'info',
      deal_id: deal.id,
    })

    return new Response(JSON.stringify({
      success: true,
      message: `You joined as ${deal.creator_role === 'BUYER' ? 'seller' : 'buyer'}`,
      deal_id: deal.id,
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
