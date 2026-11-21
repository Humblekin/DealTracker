import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.106.2'
import { corsHeaders, handleCors, methodNotAllowed } from '../_shared/cors.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

serve(async (req) => {
  const cors = corsHeaders(req.headers.get('Origin'))
  const corsRes = handleCors(req)
  if (corsRes) return corsRes
  if (req.method !== 'POST') return methodNotAllowed(req)

  try {
    const token = req.headers.get('Authorization')?.replace(/^Bearer\s+/i, '')
    if (!token) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: cors })

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    })
    const { data: { user }, error: authError } = await supabase.auth.getUser(token)
    if (authError || !user) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: cors })

    const { deal_id, note } = await req.json()
    if (!deal_id) return new Response(JSON.stringify({ error: 'deal_id is required' }), { status: 400, headers: cors })

    const { data, error } = await supabase.rpc('admin_refund_deal', {
      p_deal_id: deal_id,
      p_actor_id: user.id,
      p_note: note || null,
    })
    if (error) throw error
    if (!data?.success) return new Response(JSON.stringify({ error: data?.error || 'Refund was rejected' }), { status: 409, headers: cors })

    const { data: deal, error: dealError } = await supabase
      .from('deals')
      .select('buyer_id, seller_id, title')
      .eq('id', deal_id)
      .single()
    if (dealError) throw dealError

    const notifications = [deal.buyer_id, deal.seller_id].filter(Boolean).map((user_id) => ({
      user_id,
      title: 'Deal Refunded',
      message: `The deal "${deal.title}" was refunded to the buyer by an administrator.`,
      type: 'payment',
      deal_id,
    }))
    if (notifications.length) {
      const { error: notificationError } = await supabase.from('notifications').insert(notifications)
      if (notificationError) throw notificationError
    }

    return new Response(JSON.stringify({ success: true, message: 'Deal marked refunded and participants notified.' }), { headers: cors })
  } catch (error) {
    console.error('[admin-refund-deal]', error)
    return new Response(JSON.stringify({ error: 'Unable to process the refund action.' }), { status: 500, headers: cors })
  }
})
