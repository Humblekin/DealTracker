import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.106.2'
import { corsHeaders, handleCors, methodNotAllowed } from '../_shared/cors.ts'
import { hashShareToken, isValidShareTokenFormat } from '../_shared/linkguard.ts'

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
    const bearer = authHeader?.match(/^Bearer\s+(\S+)$/i)?.[1]
    if (!bearer) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: cors,
      })
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    })

    const { data: { user }, error: userError } = await supabase.auth.getUser(bearer)
    if (userError || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: cors,
      })
    }

    const { share_token } = await req.json()
    if (!isValidShareTokenFormat(share_token)) {
      return new Response(JSON.stringify({ error: 'A valid share_token is required' }), {
        status: 400,
        headers: cors,
      })
    }

    const tokenHash = await hashShareToken(share_token)
    const { data: deal, error: dealError } = await supabase
      .from('deals')
      .select('*')
      .eq('share_token_hash', tokenHash)
      .single()

    if (dealError || !deal) {
      return new Response(JSON.stringify({ error: 'Deal not found' }), {
        status: 404,
        headers: cors,
      })
    }

    if (deal.link_revoked) {
      return new Response(JSON.stringify({ error: 'This transaction link has been revoked' }), {
        status: 410,
        headers: cors,
      })
    }

    const nowIso = new Date().toISOString()
    if (deal.link_expires_at && deal.link_expires_at < nowIso) {
      return new Response(JSON.stringify({ error: 'This transaction link has expired' }), {
        status: 410,
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
    const roleNullCol = deal.creator_role === 'BUYER' ? 'seller_id' : 'buyer_id'

    // Atomic state-guarded update prevents concurrent join / revocation / expiration races
    const { data: updatedDeal, error: updateError } = await supabase
      .from('deals')
      .update(updateData)
      .eq('id', deal.id)
      .eq('status', 'AWAITING_COUNTERPARTY')
      .eq('link_revoked', false)
      .is(roleNullCol, null)
      .or(`link_expires_at.is.null,link_expires_at.gt.${nowIso}`)
      .select('id')
      .maybeSingle()

    if (updateError) {
      throw new Error('Failed to join deal')
    }

    if (!updatedDeal) {
      return new Response(JSON.stringify({ error: 'This deal is no longer available to join' }), {
        status: 409,
        headers: cors,
      })
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
