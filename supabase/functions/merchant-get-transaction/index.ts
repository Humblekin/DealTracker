import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.106.2'
import { corsHeaders, handleCors, methodNotAllowed } from '../_shared/cors.ts'
import { authenticateMerchant, AuthError } from '../_shared/merchant-auth.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

serve(async (req) => {
  const origin = req.headers.get('Origin')
  const cors = corsHeaders(origin)

  const corsRes = handleCors(req)
  if (corsRes) return corsRes

  if (req.method !== 'GET') return methodNotAllowed(req)

  try {
    const apiKey = req.headers.get('X-Api-Key')
    if (!apiKey) {
      return new Response(JSON.stringify({ error: 'X-Api-Key header is required' }), { status: 401, headers: cors })
    }

    const auth = await authenticateMerchant(apiKey)
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    })

    // Extract transaction ID from URL path
    const url = new URL(req.url)
    const pathParts = url.pathname.split('/')
    const transactionId = pathParts[pathParts.length - 1]

    // Also support query params
    const merchantOrderId = url.searchParams.get('merchant_order_id')

    if (!transactionId && !merchantOrderId) {
      return new Response(JSON.stringify({
        error: 'Transaction ID is required in the URL path, or provide merchant_order_id query parameter',
      }), { status: 400, headers: cors })
    }

    if (transactionId === 'transaction' && merchantOrderId) {
      // Path was /api/merchant/transaction/transaction?merchant_order_id=... 
      // This means the segment after /transaction/ is missing, use query param
    } else if (transactionId && transactionId !== 'transaction') {
      // Use the path segment as transaction_id
    }

    // Find transaction
    let query = supabase
      .from('merchant_transactions')
      .select(`
        id,
        merchant_id,
        deal_id,
        merchant_order_id,
        merchant_customer_id,
        customer_email,
        customer_name,
        amount,
        currency,
        platform_fee,
        status,
        idempotency_key,
        metadata,
        moolre_payment_url,
        shipped_at,
        delivered_at,
        created_at,
        updated_at,
        deal:deals!deal_id(
          id,
          title,
          amount,
          status,
          payment_reference,
          moolre_reference,
          platform_fee,
          net_amount,
          fee_breakdown,
          created_at,
          updated_at
        )
      `)
      .eq('merchant_id', auth.merchantId)

    if (transactionId && transactionId !== 'transaction') {
      query = query.eq('id', transactionId)
    } else if (merchantOrderId) {
      query = query.eq('merchant_order_id', merchantOrderId)
    }

    const { data: transaction, error: txError } = await query.single()

    if (txError || !transaction) {
      return new Response(JSON.stringify({ error: 'Transaction not found' }), { status: 404, headers: cors })
    }

    // Fetch audit logs for this deal (if deal exists)
    let auditLogs: unknown[] = []
    if (transaction.deal_id) {
      const { data: logs } = await supabase
        .from('audit_logs')
        .select('action, details, created_at')
        .eq('deal_id', transaction.deal_id)
        .order('created_at', { ascending: true })

      auditLogs = logs || []
    }

    return new Response(JSON.stringify({
      success: true,
      transaction: {
        id: transaction.id,
        merchant_order_id: transaction.merchant_order_id,
        merchant_customer_id: transaction.merchant_customer_id,
        customer: {
          name: transaction.customer_name,
          email: transaction.customer_email,
        },
        amount: parseFloat(transaction.amount),
        currency: transaction.currency,
        platform_fee: parseFloat(transaction.platform_fee),
        status: transaction.status,
        payment_url: transaction.moolre_payment_url,
        deal: transaction.deal ? {
          id: transaction.deal.id,
          title: transaction.deal.title,
          amount: parseFloat(transaction.deal.amount),
          status: transaction.deal.status,
          payment_reference: transaction.deal.payment_reference,
          moolre_reference: transaction.deal.moolre_reference,
          platform_fee: transaction.deal.platform_fee ? parseFloat(transaction.deal.platform_fee) : null,
          net_amount: transaction.deal.net_amount ? parseFloat(transaction.deal.net_amount) : null,
          fee_breakdown: transaction.deal.fee_breakdown,
        } : null,
        timeline: {
          created: transaction.created_at,
          shipped: transaction.shipped_at,
          delivered: transaction.delivered_at,
        },
        audit_logs: auditLogs,
        metadata: transaction.metadata,
      },
    }), { headers: cors })

  } catch (err) {
    if (err instanceof AuthError) {
      return new Response(JSON.stringify({ error: err.message }), { status: 401, headers: cors })
    }
    return new Response(JSON.stringify({
      error: err instanceof Error ? err.message : 'Internal server error',
    }), { status: 500, headers: cors })
  }
})
