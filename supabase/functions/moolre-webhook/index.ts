// ---------------------------------------------------------------
// Moolre Sandbox Webhook Handler
// Called by Moolre sandbox after a payment is processed.
// Verifies payment status with Moolre sandbox API
// (POST /open/transact/status) before updating deal state.
// Reuses existing sandbox credentials — no production changes.
// ---------------------------------------------------------------
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.106.2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const MOOLRE_API_USER = Deno.env.get('MOOLRE_API_USER')!
const MOOLRE_PUBLIC_KEY = Deno.env.get('MOOLRE_PUBLIC_KEY')!
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
    const payload = await req.json()
    const reference = payload.externalref || payload.data?.externalref
    const moolreRef = payload.data?.reference || reference

    if (!reference) {
      return new Response(JSON.stringify({ error: 'Missing reference' }), {
        status: 400,
        headers: cors,
      })
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    })

    // Find deal by payment_reference (needed before verification for refs)
    const { data: deals, findError } = await supabase
      .from('deals')
      .select('id, status, buyer_id, seller_id, title, amount, moolre_reference')
      .eq('payment_reference', reference)

    if (findError || !deals || deals.length === 0) {
      return new Response(JSON.stringify({ error: 'No deal found for this reference' }), {
        status: 404,
        headers: cors,
      })
    }

    const deal = deals[0]
    const lookupRef = deal.moolre_reference || moolreRef || reference

    // Determine if this is a manual confirmation from the frontend (sandbox/testing bypass)
    const isManualConfirm = payload.manual_confirm === true

    let paymentSuccessful = false

    if (isManualConfirm) {
      paymentSuccessful = true
      await supabase.from('audit_logs').insert({
        deal_id: deal.id,
        action: 'PAYMENT_MANUAL_CONFIRMED',
        actor_id: deal.buyer_id,
        details: { reference, note: 'Manually confirmed via sandbox bypass' },
      })
    } else {
      // Verify payment status with Moolre API (use Moolre's own reference, not the external one)
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
          id: lookupRef,
          accountnumber: MOOLRE_ACCOUNT_NUMBER,
        }),
      })
      const verifyData = await verifyRes.json()

      const verifyStatusOk = verifyData.data?.status === 1 || verifyData.data?.status === '1' || verifyData.status === 1 || verifyData.status === '1'
      paymentSuccessful = payload.status === 1 ||
        payload.status === '1' ||
        payload.status === 'success' ||
        payload.status === 'SUCCESS' ||
        verifyStatusOk

      if (!paymentSuccessful) {
        await supabase.from('audit_logs').insert({
          deal_id: deal.id,
          action: 'PAYMENT_VERIFY_FAILED',
          actor_id: deal.buyer_id,
          details: {
            reference,
            moolre_reference: lookupRef,
            verify_response: verifyData,
            verify_status: verifyRes.status,
          },
        })
      }
    }

    if (!paymentSuccessful) {
      return new Response(JSON.stringify({ received: true, processed: false, reason: 'Payment not successful' }), {
        status: 200,
        headers: cors,
      })
    }

    // Atomic update to IN_ESCROW — only if still AWAITING_PAYMENT (prevents race condition)
    const { data: updatedDeal, error: updateError } = await supabase
      .from('deals')
      .update({
        status: 'IN_ESCROW',
        moolre_reference: moolreRef || reference,
      })
      .eq('id', deal.id)
      .eq('status', 'AWAITING_PAYMENT')
      .select('id')
      .single()

    if (updateError || !updatedDeal) {
      return new Response(JSON.stringify({
        received: true, processed: false,
        reason: 'Deal was not in AWAITING_PAYMENT (concurrent update or already processed)',
      }), { status: 200, headers: cors })
    }

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
      headers: cors,
    })

  } catch (err) {
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : 'Internal server error' }), {
      status: 500,
      headers: cors,
    })
  }
})
