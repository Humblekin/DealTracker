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

    const { data: merchant } = await supabase
      .from('merchants')
      .select('id, status')
      .eq('user_id', user.id)
      .maybeSingle()

    if (!merchant) {
      return new Response(JSON.stringify({ error: 'No merchant application found. Please apply first.' }), { status: 400, headers: cors })
    }

    if (merchant.status !== 'ACTIVE') {
      return new Response(JSON.stringify({ error: 'Your merchant application has not been approved yet.' }), { status: 403, headers: cors })
    }

    const { name, environment = 'test', permissions = {} } = await req.json()

    if (!name) {
      return new Response(JSON.stringify({ error: 'name is required' }), { status: 400, headers: cors })
    }

    if (environment !== 'test' && environment !== 'live') {
      return new Response(JSON.stringify({ error: 'environment must be "test" or "live"' }), { status: 400, headers: cors })
    }

    const prefixBytes = crypto.getRandomValues(new Uint8Array(4))
    const prefix = Array.from(prefixBytes).map(b => b.toString(36).toLowerCase()).join('')

    const secretBytes = crypto.getRandomValues(new Uint8Array(24))
    const secret = Array.from(secretBytes).map(b => b.toString(36).toLowerCase()).join('')

    const rawKey = `dg_${environment}_${prefix}_${secret}`

    const fullKeyBytes = new TextEncoder().encode(rawKey)
    const hashBuffer = await crypto.subtle.digest('SHA-256', fullKeyBytes)
    const hashArray = Array.from(new Uint8Array(hashBuffer))
    const keyHash = hashArray.map(b => b.toString(16).padStart(2, '0')).join('')

    const { data: keyRecord, error: insertError } = await supabase
      .from('merchant_api_keys')
      .insert({
        merchant_id: merchant.id,
        name,
        environment,
        key_hash: keyHash,
        key_prefix: prefix,
        permissions: typeof permissions === 'object' ? permissions : {},
        is_active: true,
        expires_at: null,
      })
      .select('id, name, environment, key_prefix, is_active, created_at, expires_at')
      .single()

    if (insertError) {
      throw insertError
    }

    return new Response(JSON.stringify({
      success: true,
      key: rawKey,
      key_id: keyRecord.id,
      name: keyRecord.name,
      environment: keyRecord.environment,
      key_prefix: keyRecord.key_prefix,
      created_at: keyRecord.created_at,
      warning: 'Store this key securely. It will not be shown again.',
    }), { status: 201, headers: cors })

  } catch (err) {
    return new Response(JSON.stringify({
      error: err instanceof Error ? err.message : 'Internal server error',
    }), { status: 500, headers: cors })
  }
})
