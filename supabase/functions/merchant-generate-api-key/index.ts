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

    const { data: caller } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single()

    if (caller?.role !== 'admin') {
      return new Response(JSON.stringify({ error: 'Only admins can generate API keys' }), { status: 403, headers: cors })
    }

    const { merchant_id } = await req.json()
    if (!merchant_id) {
      return new Response(JSON.stringify({ error: 'merchant_id is required' }), { status: 400, headers: cors })
    }

    // Verify merchant exists and is ACTIVE
    const { data: merchant, error: merchantError } = await supabase
      .from('merchants')
      .select('id, name, email, status')
      .eq('id', merchant_id)
      .single()

    if (merchantError || !merchant) {
      return new Response(JSON.stringify({ error: 'Merchant not found' }), { status: 404, headers: cors })
    }

    if (merchant.status !== 'ACTIVE') {
      return new Response(JSON.stringify({ error: 'Merchant must be ACTIVE before generating API keys' }), { status: 400, headers: cors })
    }

    // Generate API key
    const prefix = crypto.randomUUID().slice(0, 8)
    const secret = crypto.randomUUID().replace(/-/g, '')
    const apiKey = `dg_${prefix}_${secret}`

    const fullKeyBytes = new TextEncoder().encode(apiKey)
    const hashBuffer = await crypto.subtle.digest('SHA-256', fullKeyBytes)
    const hashArray = Array.from(new Uint8Array(hashBuffer))
    const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('')

    await supabase.from('merchant_api_keys').insert({
      merchant_id: merchant.id,
      key_hash: hashHex,
      key_prefix: prefix,
      label: 'Primary',
    })

    await supabase.from('audit_logs').insert({
      action: 'MERCHANT_API_KEY_GENERATED',
      actor_id: user.id,
      details: {
        merchant_id: merchant.id,
        merchant_name: merchant.name,
        key_prefix: prefix,
      },
    })

    return new Response(JSON.stringify({
      success: true,
      merchant_id: merchant.id,
      api_key: apiKey,
      key_prefix: prefix,
      message: 'Store this API key securely. It will not be shown again.',
    }), { status: 201, headers: cors })

  } catch (err) {
    return new Response(JSON.stringify({
      error: err instanceof Error ? err.message : 'Internal server error',
    }), { status: 500, headers: cors })
  }
})
