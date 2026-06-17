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

    if (!merchant_id || !access_token) {
      return new Response(JSON.stringify({ error: 'merchant_id and access_token are required' }), { status: 400, headers: cors })
    }

    const { data: merchant, error: merchantError } = await supabase
      .from('merchants')
      .select('id, name, email, status, settings')
      .eq('id', merchant_id)
      .single()

    if (merchantError || !merchant) {
      return new Response(JSON.stringify({ error: 'Merchant not found' }), { status: 404, headers: cors })
    }

    const settings = (typeof merchant.settings === 'string' ? JSON.parse(merchant.settings) : merchant.settings) || {}
    if (settings.access_token !== access_token) {
      return new Response(JSON.stringify({ error: 'Invalid access token' }), { status: 401, headers: cors })
    }

    const { count: keyCount } = await supabase
      .from('merchant_api_keys')
      .select('*', { count: 'exact', head: true })
      .eq('merchant_id', merchant.id)

    const message =
      merchant.status === 'ACTIVE' ? 'Your application has been approved. You can now generate API keys.' :
      merchant.status === 'REJECTED' ? 'Your application has been rejected. Contact the admin for more information.' :
      'Your application is pending review. Check back later.'

    return new Response(JSON.stringify({
      success: true,
      merchant_id: merchant.id,
      name: merchant.name,
      email: merchant.email,
      status: merchant.status,
      key_count: keyCount || 0,
      message,
    }), { status: 200, headers: cors })

  } catch (err) {
    return new Response(JSON.stringify({
      error: err instanceof Error ? err.message : 'Internal server error',
    }), { status: 500, headers: cors })
  }
})
