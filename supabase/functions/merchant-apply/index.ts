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

    const { name, email, platform_url, description } = await req.json()

    if (!name || !email) {
      return new Response(JSON.stringify({ error: 'name and email are required' }), { status: 400, headers: cors })
    }

    if (!email.includes('@')) {
      return new Response(JSON.stringify({ error: 'Invalid email address' }), { status: 400, headers: cors })
    }

    const { data: merchant, error: merchantError } = await supabase
      .from('merchants')
      .insert({
        name,
        email,
        platform_url: platform_url || null,
        webhook_url: null,
        status: 'PENDING',
        is_active: false,
        settings: { description: description || '' },
      })
      .select()
      .single()

    if (merchantError) {
      if (merchantError.code === '23505') {
        return new Response(JSON.stringify({
          success: true,
          message: 'An application with this email already exists. We will review it shortly.',
        }), { status: 200, headers: cors })
      }
      throw merchantError
    }

    return new Response(JSON.stringify({
      success: true,
      message: 'Application submitted successfully. An admin will review and approve your access.',
    }), { status: 201, headers: cors })

  } catch (err) {
    return new Response(JSON.stringify({
      error: err instanceof Error ? err.message : 'Internal server error',
    }), { status: 500, headers: cors })
  }
})
