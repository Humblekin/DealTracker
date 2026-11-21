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

    const { deal_id, action, reason } = await req.json()
    if (!deal_id || !['cancel', 'dispute'].includes(action)) {
      return new Response(JSON.stringify({ error: 'deal_id and a supported action are required' }), { status: 400, headers: cors })
    }

    const { data, error } = await supabase.rpc('apply_deal_action', {
      p_deal_id: deal_id,
      p_actor_id: user.id,
      p_action: action,
      p_reason: reason || null,
    })
    if (error) throw error
    if (!data?.success) return new Response(JSON.stringify({ error: data?.error || 'Deal action was rejected' }), { status: 409, headers: cors })

    return new Response(JSON.stringify({ success: true, status: data.status }), { headers: cors })
  } catch (error) {
    console.error('[deal-action]', error)
    return new Response(JSON.stringify({ error: 'Unable to apply this deal action.' }), { status: 500, headers: cors })
  }
})
