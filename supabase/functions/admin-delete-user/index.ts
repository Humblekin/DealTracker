// ---------------------------------------------------------------
// Admin Delete User
// Admin-only function that fully deletes a user account:
//   - Cancels their open deals and detaches them as a party
//   - Removes their notifications, disputes, and audit log entries
//   - Deletes the profile row and the auth.users record
// Guarded rules:
//   - Admin cannot delete their own account
//   - Deletion is blocked if the user holds funds in active escrow
// ---------------------------------------------------------------
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.106.2'
import { corsHeaders, handleCors, methodNotAllowed } from '../_shared/cors.ts'

const ESCROW_STATES = ['IN_ESCROW', 'DELIVERED', 'DISPUTED']

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
      return new Response(JSON.stringify({ error: 'Only admins can delete users' }), { status: 403, headers: cors })
    }

    const { user_id } = await req.json()
    if (!user_id) {
      return new Response(JSON.stringify({ error: 'user_id is required' }), { status: 400, headers: cors })
    }

    if (user_id === user.id) {
      return new Response(JSON.stringify({ error: 'Admins cannot delete their own account' }), { status: 400, headers: cors })
    }

    const { data: target, error: targetError } = await supabase
      .from('profiles')
      .select('id, full_name, email')
      .eq('id', user_id)
      .maybeSingle()

    if (targetError) throw targetError

    // Find the user's deals
    const { data: deals, error: dealsError } = await supabase
      .from('deals')
      .select('id, status, buyer_id, seller_id')
      .or(`buyer_id.eq.${user_id},seller_id.eq.${user_id}`)

    if (dealsError) throw dealsError

    const activeEscrow = (deals || []).filter((d) => ESCROW_STATES.includes(d.status))
    if (activeEscrow.length > 0) {
      return new Response(JSON.stringify({
        error: `Cannot delete user: they hold funds in ${activeEscrow.length} active escrow deal(s). Resolve or refund these deals first.`,
      }), { status: 409, headers: cors })
    }

    const dealIds = (deals || []).map((d) => d.id)

    // 1. Cancel pending deals and detach the user as a party
    await Promise.all((deals || []).map((d) =>
      supabase.from('deals').update({
        status: d.status === 'AWAITING_COUNTERPARTY' || d.status === 'AWAITING_PAYMENT'
          ? 'CANCELLED'
          : d.status,
        ...(d.buyer_id === user_id && { buyer_id: null }),
        ...(d.seller_id === user_id && { seller_id: null }),
      }).eq('id', d.id)
    ))

    // 2. Remove the user's notifications
    const { error: notifError } = await supabase
      .from('notifications')
      .delete()
      .eq('user_id', user_id)
    if (notifError) throw notifError

    // 3. Remove disputes they opened
    const { error: disputeError } = await supabase
      .from('disputes')
      .delete()
      .eq('opened_by', user_id)
    if (disputeError) throw disputeError

    // 4. Remove audit logs they authored
    const { error: auditError } = await supabase
      .from('audit_logs')
      .delete()
      .eq('actor_id', user_id)
    if (auditError) throw auditError

    // 5. Record the deletion in the admin's audit trail first
    if (dealIds.length > 0) {
      await supabase.from('audit_logs').insert({
        deal_id: dealIds[0],
        action: 'USER_DELETED',
        actor_id: user.id,
        details: {
          deleted_user_id: user_id,
          deleted_name: target?.full_name || null,
          deleted_email: target?.email || null,
          cancelled_deals: deals.filter((d) => d.status === 'AWAITING_COUNTERPARTY' || d.status === 'AWAITING_PAYMENT').length,
        },
      })
    }

    // 6. Delete the auth user (cascades to the profile row)
    const { error: deleteError } = await supabase.auth.admin.deleteUser(user_id)
    if (deleteError) throw deleteError

    return new Response(JSON.stringify({
      success: true,
      message: 'User account deleted',
      cancelled_deals: deals.filter((d) => d.status === 'AWAITING_COUNTERPARTY' || d.status === 'AWAITING_PAYMENT').length,
    }), { status: 200, headers: cors })

  } catch (err) {
    return new Response(JSON.stringify({
      error: err instanceof Error ? err.message : 'Internal server error',
    }), { status: 500, headers: cors })
  }
})