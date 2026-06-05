import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.106.2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const MOOLRE_API_USER = Deno.env.get('MOOLRE_API_USER')!
const MOOLRE_PUBLIC_KEY = Deno.env.get('MOOLRE_PUBLIC_KEY')!
const MOOLRE_ACCOUNT_NUMBER = Deno.env.get('MOOLRE_ACCOUNT_NUMBER')!
const MOOLRE_BASE_URL = Deno.env.get('MOOLRE_BASE_URL') || 'https://api.moolre.com'

const ALLOWED_ORIGINS = [
  'http://localhost:5173',
  'http://localhost:5174',
  'http://localhost:4173',
  'https://dealtracker.vercel.app',
  SUPABASE_URL,
]

function corsHeaders(origin: string | null): Record<string, string> {
  const allowed = ALLOWED_ORIGINS.includes(origin || '') ? origin! : 'https://dealtracker.vercel.app'
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
        headers: { 'Content-Type': 'application/json', ...cors },
      })
    }

    const { deal_id, redirect_url } = await req.json()
    if (!deal_id) {
      return new Response(JSON.stringify({ error: 'deal_id is required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', ...cors },
      })
    }

    const { data: deal, error: dealError } = await supabase
      .from('deals')
      .select('*, buyer:profiles!buyer_id(email, full_name)')
      .eq('id', deal_id)
      .single()

    if (dealError || !deal) {
      return new Response(JSON.stringify({ error: 'Deal not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json', ...cors },
      })
    }

    if (deal.buyer_id !== user.id) {
      return new Response(JSON.stringify({ error: 'Only the buyer can initiate payment' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json', ...cors },
      })
    }

    if (deal.status !== 'AWAITING_PAYMENT') {
      return new Response(JSON.stringify({ error: `Deal is in "${deal.status}" status, expected AWAITING_PAYMENT` }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', ...cors },
      })
    }

    const externalRef = `ST-${deal.id}-${Date.now()}`
    const callbackUrl = `${SUPABASE_URL}/functions/v1/moolre-webhook`

    const moolreRes = await fetch(`${MOOLRE_BASE_URL}/embed/link`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-USER': MOOLRE_API_USER,
        'X-API-PUBKEY': MOOLRE_PUBLIC_KEY,
      },
      body: JSON.stringify({
        type: 1,
        amount: parseFloat(deal.amount).toString(),
        email: deal.buyer.email,
        currency: 'GHS',
        externalref: externalRef,
        callback: callbackUrl,
        redirect: redirect_url || `${SUPABASE_URL}/functions/v1/moolre-webhook`,
        reusable: '0',
        accountnumber: MOOLRE_ACCOUNT_NUMBER,
        metadata: {
          deal_id: deal.id,
          buyer_id: deal.buyer_id,
        },
      }),
    })

    const moolreData = await moolreRes.json()

    if (!moolreRes.ok || moolreData.status !== 1) {
      await supabase.from('audit_logs').insert({
        deal_id: deal.id,
        action: 'PAYMENT_INIT_FAILED',
        actor_id: user.id,
        details: { error: moolreData, reference: externalRef },
      })

      return new Response(JSON.stringify({
        error: moolreData.message || 'Failed to initialize payment with Moolre',
      }), {
        status: 502,
        headers: { 'Content-Type': 'application/json', ...cors },
      })
    }

    const paymentUrl = moolreData.data?.authorization_url
    const moolreRef = moolreData.data?.reference || externalRef

    await supabase.from('deals').update({
      payment_reference: externalRef,
      moolre_reference: moolreRef,
    }).eq('id', deal.id)

    await supabase.from('audit_logs').insert({
      deal_id: deal.id,
      action: 'PAYMENT_INITIATED',
      actor_id: user.id,
      details: { reference: externalRef, moolre_reference: moolreRef },
    })

    return new Response(JSON.stringify({
      success: true,
      authorization_url: paymentUrl,
      reference: externalRef,
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json', ...cors },
    })

  } catch (err) {
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : 'Internal server error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', ...cors },
    })
  }
})
