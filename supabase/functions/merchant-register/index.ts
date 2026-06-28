import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.106.2'
import { corsHeaders, handleCors, methodNotAllowed } from '../_shared/cors.ts'

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

    const { data: caller } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single()

    if (caller?.role !== 'admin') {
      return new Response(JSON.stringify({ error: 'Only admins can register merchants' }), { status: 403, headers: cors })
    }

    const { name, email, user_id, platform_url, webhook_url } = await req.json()
    if (!name || !email) {
      return new Response(JSON.stringify({ error: 'name and email are required' }), { status: 400, headers: cors })
    }

    // Create merchant (admin registration = pre-approved)
    const { data: merchant, error: merchantError } = await supabase
      .from('merchants')
      .insert({
        name,
        email,
        user_id: user_id || null,
        platform_url: platform_url || null,
        webhook_url: webhook_url || null,
        status: 'ACTIVE',
        is_active: true,
        settings: {},
      })
      .select()
      .single()

    if (merchantError) {
      if (merchantError.code === '23505') {
        return new Response(JSON.stringify({ error: 'A merchant with this email already exists' }), { status: 409, headers: cors })
      }
      throw merchantError
    }

    // Generate API key: dg_{environment}_{prefix}_{secret}
    const prefixBytes = crypto.getRandomValues(new Uint8Array(4))
    const prefix = Array.from(prefixBytes).map(b => b.toString(36).toLowerCase()).join('')

    const secretBytes = crypto.getRandomValues(new Uint8Array(24))
    const secret = Array.from(secretBytes).map(b => b.toString(36).toLowerCase()).join('')

    const apiKey = `dg_live_${prefix}_${secret}`

    const fullKeyBytes = new TextEncoder().encode(apiKey)
    const hashBuffer = await crypto.subtle.digest('SHA-256', fullKeyBytes)
    const hashArray = Array.from(new Uint8Array(hashBuffer))
    const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('')

    await supabase.from('merchant_api_keys').insert({
      merchant_id: merchant.id,
      name: 'Primary',
      environment: 'live',
      key_hash: hashHex,
      key_prefix: prefix,
      permissions: {},
    })

    // Audit log
    await supabase.from('audit_logs').insert({
      action: 'MERCHANT_REGISTERED',
      actor_id: user.id,
      details: {
        merchant_id: merchant.id,
        merchant_name: name,
        merchant_email: email,
      },
    })

    return new Response(JSON.stringify({
      success: true,
      merchant: {
        id: merchant.id,
        name: merchant.name,
        email: merchant.email,
        platform_url: merchant.platform_url,
        webhook_url: merchant.webhook_url,
        webhook_secret: merchant.webhook_secret,
      },
      api_key: apiKey,
      message: 'Store this API key securely. It will not be shown again.',
    }), { status: 201, headers: cors })

  } catch (err) {
    return new Response(JSON.stringify({
      error: err instanceof Error ? err.message : 'Internal server error',
    }), { status: 500, headers: cors })
  }
})
