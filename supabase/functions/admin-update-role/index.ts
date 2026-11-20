// ---------------------------------------------------------------
// Admin Update Role — Trusted Server-Side Administrative Process
// Admin-only function to modify a user's role:
//   - Verifies the caller is an authenticated administrator
//   - Validates the target user exists and the new role is valid
//   - Prevents administrators from modifying their own role
//   - Uses SUPABASE_SERVICE_ROLE_KEY to perform the protected update
//   - Records an immutable audit log entry for the role change
// ---------------------------------------------------------------
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.106.2'
import { corsHeaders, handleCors, methodNotAllowed } from '../_shared/cors.ts'

const ALLOWED_ROLES = ['buyer', 'seller', 'admin']

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
      return new Response(JSON.stringify({ error: 'Only administrators can update user roles' }), { status: 403, headers: cors })
    }

    let body
    try {
      body = await req.json()
    } catch {
      return new Response(JSON.stringify({ error: 'Invalid JSON request body' }), { status: 400, headers: cors })
    }

    const { user_id, role } = body || {}
    if (!user_id || !role) {
      return new Response(JSON.stringify({ error: 'user_id and role are required' }), { status: 400, headers: cors })
    }

    if (!ALLOWED_ROLES.includes(role)) {
      return new Response(JSON.stringify({ error: `Invalid role "${role}". Allowed roles: ${ALLOWED_ROLES.join(', ')}` }), { status: 400, headers: cors })
    }

    if (user_id === user.id) {
      return new Response(JSON.stringify({ error: 'Administrators cannot modify their own role' }), { status: 400, headers: cors })
    }

    const { data: targetUser, error: targetError } = await supabase
      .from('profiles')
      .select('id, role, full_name, email')
      .eq('id', user_id)
      .maybeSingle()

    if (targetError || !targetUser) {
      return new Response(JSON.stringify({ error: 'User not found' }), { status: 404, headers: cors })
    }

    const oldRole = targetUser.role

    // Perform role update via service role (bypasses RLS and trigger restrictions)
    const { data: updatedProfile, error: updateError } = await supabase
      .from('profiles')
      .update({ role })
      .eq('id', user_id)
      .select('id, full_name, email, role')
      .single()

    if (updateError) throw updateError

    // Record administrative role change in audit logs
    await supabase.from('audit_logs').insert({
      action: 'ADMIN_ROLE_UPDATED',
      actor_id: user.id,
      details: {
        target_user_id: user_id,
        target_user_email: targetUser.email,
        old_role: oldRole,
        new_role: role,
      },
    })

    return new Response(JSON.stringify({
      success: true,
      message: `User role updated from ${oldRole} to ${role}`,
      profile: updatedProfile,
    }), { status: 200, headers: cors })

  } catch (err) {
    return new Response(JSON.stringify({
      error: err instanceof Error ? err.message : 'Internal server error',
    }), { status: 500, headers: cors })
  }
})

