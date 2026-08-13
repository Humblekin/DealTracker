// ---------------------------------------------------------------
// Paystack Payment Initiation
// Authenticated buyer initializes a Paystack checkout session for
// a deal in AWAITING_PAYMENT status. Returns the authorization
// URL + access code for the Paystack Inline popup.
// ---------------------------------------------------------------
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.106.2'
import { corsHeaders, handleCors, methodNotAllowed } from '../_shared/cors.ts'
import { initPayment } from '../_shared/paystack.ts'

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

    const { deal_id, redirect_url } = await req.json()
    if (!deal_id) {
      return new Response(JSON.stringify({ error: 'deal_id is required' }), { status: 400, headers: cors })
    }

    const { data: deal, error: dealError } = await supabase
      .from('deals')
      .select('*, buyer:profiles!buyer_id(email, full_name)')
      .eq('id', deal_id)
      .single()

    if (dealError || !deal) {
      return new Response(JSON.stringify({ error: 'Deal not found' }), { status: 404, headers: cors })
    }

    if (deal.buyer_id !== user.id) {
      return new Response(JSON.stringify({ error: 'Only the buyer can initiate payment' }), { status: 403, headers: cors })
    }

    if (deal.status !== 'AWAITING_PAYMENT') {
      return new Response(JSON.stringify({
        error: `Deal is in "${deal.status}" status, expected AWAITING_PAYMENT`,
      }), { status: 400, headers: cors })
    }

    const reference = `ST-${deal.id}-${Date.now()}`

    const paymentResult = await initPayment({
      amount: deal.amount,
      email: deal.buyer.email,
      reference,
      callbackUrl: redirect_url || `${SUPABASE_URL}/functions/v1/paystack-webhook`,
      metadata: {
        deal_id: deal.id,
        buyer_id: deal.buyer_id,
        provider: 'paystack',
      },
    })

    if (!paymentResult.success) {
      await supabase.from('audit_logs').insert({
        deal_id: deal.id,
        action: 'PAYMENT_INIT_FAILED',
        actor_id: user.id,
        details: { error: paymentResult.error, reference },
      })

      return new Response(JSON.stringify({ error: paymentResult.error }), { status: 502, headers: cors })
    }

    // Persist payment reference + status on the deal
    const { error: updateError } = await supabase
      .from('deals')
      .update({
        payment_reference: reference,
        paystack_reference: paymentResult.reference || reference,
        payment_status: 'PENDING',
      })
      .eq('id', deal.id)

    if (updateError) throw updateError

    await supabase.from('audit_logs').insert({
      deal_id: deal.id,
      action: 'PAYMENT_INITIATED',
      actor_id: user.id,
      details: { reference, paystack_reference: paymentResult.reference || reference },
    })

    return new Response(JSON.stringify({
      success: true,
      authorization_url: paymentResult.authorization_url,
      access_code: paymentResult.access_code,
      reference: paymentResult.reference || reference,
    }), { status: 200, headers: cors })

  } catch (err) {
    return new Response(JSON.stringify({
      error: err instanceof Error ? err.message : 'Internal server error',
    }), { status: 500, headers: cors })
  }
})
