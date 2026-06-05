import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.106.2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const MOOLRE_API_USER = Deno.env.get('MOOLRE_API_USER')!
const MOOLRE_PUBLIC_KEY = Deno.env.get('MOOLRE_PUBLIC_KEY')!
const MOOLRE_ACCOUNT_NUMBER = Deno.env.get('MOOLRE_ACCOUNT_NUMBER')!
const MOOLRE_BASE_URL = Deno.env.get('MOOLRE_BASE_URL') || 'https://api.moolre.com'

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
      headers: { 'Content-Type': 'application/json' },
    })
  }

  try {
    const payload = await req.json()
    const reference = payload.externalref || payload.data?.externalref
    const moolreRef = payload.data?.reference || reference

    console.log('Webhook payload:', JSON.stringify(payload))

    if (!reference) {
      return new Response(JSON.stringify({ error: 'Missing reference' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    })

    // Verify payment status with Moolre API
    const verifyRes = await fetch(`${MOOLRE_BASE_URL}/open/transact/status`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-USER': MOOLRE_API_USER,
        'X-API-PUBKEY': MOOLRE_PUBLIC_KEY,
      },
      body: JSON.stringify({
        type: 1,
        idtype: '1',
        id: reference,
        accountnumber: MOOLRE_ACCOUNT_NUMBER,
      }),
    })
    const verifyData = await verifyRes.json()
    console.log('Moolre verification:', JSON.stringify(verifyData))

    const paymentSuccessful = payload.status === 1 ||
      payload.status === '1' ||
      payload.status === 'success' ||
      payload.status === 'SUCCESS' ||
      verifyData.status === 1 ||
      verifyData.status === '1'

    if (!paymentSuccessful) {
      return new Response(JSON.stringify({ received: true, processed: false, reason: 'Payment not successful' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    // Find deal by payment_reference
    const { data: deals, error: findError } = await supabase
      .from('deals')
      .select('id, status, buyer_id, seller_id, title, amount')
      .eq('payment_reference', reference)

    if (findError || !deals || deals.length === 0) {
      return new Response(JSON.stringify({ error: 'No deal found for this reference' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    const deal = deals[0]
    if (deal.status !== 'PENDING_PAYMENT') {
      return new Response(JSON.stringify({ received: true, processed: false, reason: `Deal is ${deal.status}` }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    // Update deal to IN_ESCROW
    await supabase.from('deals').update({
      status: 'IN_ESCROW',
      moolre_reference: moolreRef || reference,
    }).eq('id', deal.id)

    // Record payment
    await supabase.from('payments').insert({
      deal_id: deal.id,
      moolre_reference: moolreRef || reference,
      amount: deal.amount,
      status: 'SUCCESS',
    })

    // Audit log
    await supabase.from('audit_logs').insert({
      deal_id: deal.id,
      action: 'PAYMENT_RECEIVED',
      actor_id: deal.buyer_id,
      details: { reference, moolre_reference: moolreRef || reference },
    })

    // Notify seller
    await supabase.from('notifications').insert({
      user_id: deal.seller_id,
      title: 'Payment Received',
      message: `Payment for "${deal.title}" received. Funds are in escrow. Please deliver the item.`,
      type: 'payment',
      deal_id: deal.id,
    })

    // Notify buyer
    await supabase.from('notifications').insert({
      user_id: deal.buyer_id,
      title: 'Payment Confirmed',
      message: `Your payment for "${deal.title}" is now in escrow. Confirm delivery when you receive the item.`,
      type: 'payment',
      deal_id: deal.id,
    })

    return new Response(JSON.stringify({ received: true, processed: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })

  } catch (err) {
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : 'Internal server error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }
})
