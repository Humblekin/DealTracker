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

    const { name, email, platform_url, description } = await req.json()

    if (!name || !email) {
      return new Response(JSON.stringify({ error: 'name and email are required' }), { status: 400, headers: cors })
    }

    // Check if user already has a merchant application
    const { data: existing } = await supabase
      .from('merchants')
      .select('id, status')
      .eq('user_id', user.id)
      .maybeSingle()

    if (existing) {
      // Update details for any existing application
      const updates = {
        name,
        email,
        platform_url: platform_url || null,
        settings: { description: description || '' },
      }

      // Rejected → reset to PENDING for re-review
      if (existing.status === 'REJECTED') {
        updates.status = 'PENDING'
        updates.is_active = false
      }

      const { error: updateError } = await supabase
        .from('merchants')
        .update(updates)
        .eq('id', existing.id)

      if (updateError) throw updateError

      const newStatus = existing.status === 'REJECTED' ? 'PENDING' : existing.status
      const msg = existing.status === 'REJECTED'
        ? 'Application re-submitted for review.'
        : 'Application details updated.'

      return new Response(JSON.stringify({
        success: true,
        merchant_id: existing.id,
        status: newStatus,
        message: msg,
      }), { status: 200, headers: cors })
    }

    // Check by email and backfill user_id if missing
    const { data: byEmail } = await supabase
      .from('merchants')
      .select('id, status')
      .eq('email', email)
      .maybeSingle()

    if (byEmail) {
      await supabase.from('merchants').update({ user_id: user.id }).eq('id', byEmail.id)
      return new Response(JSON.stringify({
        success: true,
        merchant_id: byEmail.id,
        status: byEmail.status,
        message: 'Application linked to your account.',
      }), { status: 200, headers: cors })
    }

    const { data: merchant, error: merchantError } = await supabase
      .from('merchants')
      .insert({
        name,
        email,
        user_id: user.id,
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
          message: 'An application with this email already exists.',
        }), { status: 200, headers: cors })
      }
      throw merchantError
    }

    return new Response(JSON.stringify({
      success: true,
      merchant_id: merchant.id,
      message: 'Application submitted successfully! An admin will review it.',
    }), { status: 201, headers: cors })

  } catch (err) {
    return new Response(JSON.stringify({
      error: err instanceof Error ? err.message : 'Internal server error',
    }), { status: 500, headers: cors })
  }
})
