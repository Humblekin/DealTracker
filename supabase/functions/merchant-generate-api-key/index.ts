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
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    })

    const { merchant_id, access_token } = await req.json()

    if (!merchant_id) {
      return new Response(JSON.stringify({ error: 'merchant_id is required' }), { status: 400, headers: cors })
    }

    let merchant: { id: string; name: string; email: string; status: string; settings: Record<string, unknown> } | null = null

    // Two auth modes:
    // 1. Admin JWT (existing flow)
    // 2. Merchant access_token (self-service flow)
    const authHeader = req.headers.get('Authorization')
    if (authHeader) {
      const { data: { user }, error: userError } = await supabase.auth.getUser(
        authHeader.replace('Bearer ', '')
      )
      if (!userError && user) {
        const { data: caller } = await supabase
          .from('profiles')
          .select('role')
          .eq('id', user.id)
          .single()

        if (caller?.role === 'admin') {
          // Admin flow — just verify merchant exists
          const { data: m } = await supabase
            .from('merchants')
            .select('id, name, email, status, settings')
            .eq('id', merchant_id)
            .single()
          merchant = m as typeof merchant
        }
      }
    }

    // If not authenticated as admin, check access_token
    if (!merchant) {
      if (!access_token) {
        return new Response(JSON.stringify({ error: 'Unauthorized. Provide admin Authorization header or merchant access_token.' }), { status: 401, headers: cors })
      }

      const { data: m } = await supabase
        .from('merchants')
        .select('id, name, email, status, settings')
        .eq('id', merchant_id)
        .single()

      if (!m) {
        return new Response(JSON.stringify({ error: 'Merchant not found' }), { status: 404, headers: cors })
      }

      const settings = (typeof m.settings === 'string' ? JSON.parse(m.settings) : m.settings) || {}
      if (settings.access_token !== access_token) {
        return new Response(JSON.stringify({ error: 'Invalid access token' }), { status: 401, headers: cors })
      }

      merchant = m as typeof merchant
    }

    if (!merchant) {
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
      actor_id: null,
      details: {
        merchant_id: merchant.id,
        merchant_name: merchant.name,
        key_prefix: prefix,
        method: access_token ? 'merchant_self_service' : 'admin',
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
