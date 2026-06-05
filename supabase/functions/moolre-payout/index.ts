import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.106.2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const MOOLRE_API_USER = Deno.env.get('MOOLRE_API_USER')!
const MOOLRE_PRIVATE_KEY = Deno.env.get('MOOLRE_PRIVATE_KEY')!
const MOOLRE_ACCOUNT_NUMBER = Deno.env.get('MOOLRE_ACCOUNT_NUMBER')!
const MOOLRE_BASE_URL = Deno.env.get('MOOLRE_BASE_URL') || 'https://api.moolre.com'

const NETWORK_CHANNEL: Record<string, string> = {
  mtn: '1',
  telecel: '6',
  at: '7',
  airteltigo: '7',
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
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': '*',
        'Access-Control-Max-Age': '86400',
      },
    })
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    })
  }

  try {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
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
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      })
    }

    const { data: caller } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single()

    if (caller?.role !== 'admin') {
      return new Response(JSON.stringify({ error: 'Only admins can manually trigger payouts' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      })
    }

    const { deal_id, amount, phone, network, narration } = await req.json()
    if (!deal_id || !amount || !phone || !network) {
      return new Response(JSON.stringify({ error: 'deal_id, amount, phone, and network are required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      })
    }

    const reference = `PO-${deal_id}-${Date.now()}`
    const result = await sendPayout(
      parseFloat(amount),
      phone,
      network,
      narration || 'SecureTrade payout',
      reference
    )

    if (!result.success) {
      return new Response(JSON.stringify({ error: result.error }), {
        status: 502,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      })
    }

    await supabase.from('audit_logs').insert({
      deal_id,
      action: 'PAYOUT_SENT',
      actor_id: user.id,
      details: { reference: result.reference, amount, phone, network },
    })

    return new Response(JSON.stringify({
      success: true,
      reference: result.reference,
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    })

  } catch (err) {
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : 'Internal server error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    })
  }
})
