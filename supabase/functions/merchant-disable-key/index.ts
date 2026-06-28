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

    const { key_id } = await req.json()

    if (!key_id) {
      return new Response(JSON.stringify({ error: 'key_id is required' }), { status: 400, headers: cors })
    }

    const { data: merchant } = await supabase
      .from('merchants')
      .select('id')
      .eq('user_id', user.id)
      .maybeSingle()

    if (!merchant) {
      return new Response(JSON.stringify({ error: 'Merchant not found' }), { status: 404, headers: cors })
    }

    const { data: keyRecord } = await supabase
      .from('merchant_api_keys')
      .select('id, merchant_id, is_active')
      .eq('id', key_id)
      .single()

    if (!keyRecord) {
      return new Response(JSON.stringify({ error: 'API key not found' }), { status: 404, headers: cors })
    }

    if (keyRecord.merchant_id !== merchant.id) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 403, headers: cors })
    }

    if (!keyRecord.is_active) {
      return new Response(JSON.stringify({ error: 'API key is already disabled' }), { status: 400, headers: cors })
    }

    const { error: updateError } = await supabase
      .from('merchant_api_keys')
      .update({ is_active: false })
      .eq('id', key_id)

    if (updateError) {
      throw updateError
    }

    return new Response(JSON.stringify({
      success: true,
      message: 'API key disabled successfully.',
    }), { status: 200, headers: cors })

  } catch (err) {
    return new Response(JSON.stringify({
      error: err instanceof Error ? err.message : 'Internal server error',
    }), { status: 500, headers: cors })
  }
})
