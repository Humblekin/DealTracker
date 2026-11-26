// ============================================================
// LinkGuard: verify-link Edge Function
// ============================================================
// Validates a DealGuider transaction share link before granting
// access to the SharedDeal page. Called by the LinkGuard
// frontend page with the share token and request origin.
//
// Security: rate-limited (trusted proxy IP, bounded map),
// strict Origin + HTTPS domain validation, UUID format check,
// SHA-256 hash verification in DB, single-log-per-window on 429,
// and sanitized deal details (no buyer/seller UUID exposure).
// ============================================================
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.106.2'
import { corsHeaders, handleCors, methodNotAllowed } from '../_shared/cors.ts'
import {
  areOriginsConsistent,
  extractClientIp,
  isAllowedDomain,
  isValidShareTokenFormat,
} from '../_shared/linkguard.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

// --- Rate limiting ---
const RATE_LIMIT_WINDOW_MS = 60_000  // 1 minute
const RATE_LIMIT_MAX = 20            // max 20 requests per minute per IP
const MAX_RATE_ENTRIES = 10_000      // cap memory growth under spoofed floods

interface RateEntry {
  count: number
  windowStart: number
}
const rateLimitMap = new Map<string, RateEntry>()

function checkRateLimit(ip: string): { limited: boolean; firstExceed: boolean } {
  const now = Date.now()
  const entry = rateLimitMap.get(ip)

  if (!entry || now - entry.windowStart > RATE_LIMIT_WINDOW_MS) {
    if (rateLimitMap.size >= MAX_RATE_ENTRIES) {
      // Evict expired entries first; if still full, drop oldest entry
      const cutoff = now - RATE_LIMIT_WINDOW_MS
      for (const [k, v] of rateLimitMap) {
        if (v.windowStart < cutoff) rateLimitMap.delete(k)
      }
      if (rateLimitMap.size >= MAX_RATE_ENTRIES) {
        const oldestKey = rateLimitMap.keys().next().value
        if (oldestKey) rateLimitMap.delete(oldestKey)
      }
    }
    rateLimitMap.set(ip, { count: 1, windowStart: now })
    return { limited: false, firstExceed: false }
  }

  entry.count++
  if (entry.count > RATE_LIMIT_MAX) {
    return { limited: true, firstExceed: entry.count === RATE_LIMIT_MAX + 1 }
  }
  return { limited: false, firstExceed: false }
}

setInterval(() => {
  const cutoff = Date.now() - RATE_LIMIT_WINDOW_MS * 2
  for (const [ip, entry] of rateLimitMap) {
    if (entry.windowStart < cutoff) rateLimitMap.delete(ip)
  }
}, 300_000)

async function logSuspiciousAttempt(
  supabase: ReturnType<typeof createClient>,
  params: {
    dealId?: string | null
    reason: string
    tokenPrefix: string
    ip: string
    origin?: string | null
  }
) {
  console.warn(
    `[verify-link] Suspicious attempt: reason=${params.reason} token_prefix=${params.tokenPrefix} ip=${params.ip}`
  )
  try {
    await supabase.from('audit_logs').insert({
      deal_id: params.dealId || null,
      action: 'LINKGUARD_SUSPICIOUS_ATTEMPT',
      actor_id: null,
      details: {
        reason: params.reason,
        token_prefix: params.tokenPrefix,
        ip: params.ip,
        origin: params.origin ? params.origin.slice(0, 120) : null,
      },
    })
  } catch (logErr) {
    console.error('[verify-link] Failed to persist security log:', logErr)
  }
}

serve(async (req) => {
  const requestOrigin = req.headers.get('Origin')
  const cors = corsHeaders(requestOrigin)

  const corsRes = handleCors(req)
  if (corsRes) return corsRes

  if (req.method !== 'POST') return methodNotAllowed(req)

  const clientIp = extractClientIp(req.headers)
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  const rateStatus = checkRateLimit(clientIp)
  if (rateStatus.limited) {
    // Log to DB only once per IP window when first exceeded to prevent log-flood DoS
    if (rateStatus.firstExceed) {
      await logSuspiciousAttempt(supabase, {
        reason: 'rate_limited',
        tokenPrefix: 'n/a',
        ip: clientIp,
        origin: requestOrigin,
      })
    }
    return new Response(JSON.stringify({
      verified: false,
      reason: 'rate_limited',
      message: 'Too many verification attempts. Please wait a moment and try again.',
    }), { status: 429, headers: { ...cors, 'Retry-After': '60' } })
  }

  try {
    const body = await req.json().catch(() => null)
    if (!body || typeof body !== 'object') {
      return new Response(JSON.stringify({
        verified: false,
        reason: 'invalid_token',
        message: "We couldn't authenticate this transaction link. For your safety, do not enter personal information or make any payment through this link.",
      }), { status: 400, headers: cors })
    }

    const { share_token, origin: clientOrigin } = body as {
      share_token?: unknown
      origin?: unknown
    }
    const tokenPrefix = typeof share_token === 'string' && share_token.length >= 8
      ? share_token.slice(0, 8)
      : 'invalid'

    // 1. Domain validation — require BOTH browser Origin header and matching client origin
    if (
      !requestOrigin
      || typeof clientOrigin !== 'string'
      || !isAllowedDomain(requestOrigin)
      || !isAllowedDomain(clientOrigin)
      || !areOriginsConsistent(requestOrigin, clientOrigin)
    ) {
      await logSuspiciousAttempt(supabase, {
        reason: 'invalid_domain',
        tokenPrefix,
        ip: clientIp,
        origin: typeof clientOrigin === 'string' ? clientOrigin : requestOrigin,
      })
      return new Response(JSON.stringify({
        verified: false,
        reason: 'invalid_domain',
        message: 'This link appears to be served from an unauthorized domain. For your safety, please visit DealGuider directly.',
      }), { status: 200, headers: cors })
    }

    // 2. Validate share token format before any DB query
    if (!isValidShareTokenFormat(share_token)) {
      await logSuspiciousAttempt(supabase, {
        reason: 'invalid_token',
        tokenPrefix,
        ip: clientIp,
        origin: clientOrigin,
      })
      return new Response(JSON.stringify({
        verified: false,
        reason: 'invalid_token',
        message: "We couldn't authenticate this transaction link. For your safety, do not enter personal information or make any payment through this link.",
      }), { status: 200, headers: cors })
    }

    const normalizedToken = share_token.trim().toLowerCase()

    // 3. Verify link via service-role-only RPC
    const { data, error } = await supabase.rpc('verify_deal_link', {
      p_share_token: normalizedToken,
    })

    if (error) {
      console.error('[verify-link] DB error:', error.message)
      return new Response(JSON.stringify({
        verified: false,
        reason: 'error',
        message: 'Unable to verify this link at the moment. Please try again later.',
      }), { status: 500, headers: cors })
    }

    // 4. Log suspicious verification failures without exposing full token or internal deal_id
    if (!data?.verified) {
      const suspiciousReasons = ['invalid_token', 'not_found', 'revoked']
      if (suspiciousReasons.includes(data?.reason)) {
        await logSuspiciousAttempt(supabase, {
          dealId: data?.deal_id || null,
          reason: data.reason,
          tokenPrefix,
          ip: clientIp,
          origin: clientOrigin,
        })
      } else {
        console.warn(`[verify-link] Blocked link: reason=${data?.reason} token_prefix=${tokenPrefix} ip=${clientIp}`)
      }

      return new Response(JSON.stringify({
        verified: false,
        reason: data?.reason || 'error',
        message: data?.message || 'This link could not be verified.',
        ...(data?.deal_status ? { deal_status: data.deal_status } : {}),
      }), { status: 200, headers: cors })
    }

    // 5. Fetch sanitized shared-deal details via service-role-only get_shared_deal
    const { data: sharedDeal, error: sharedDealError } = await supabase.rpc('get_shared_deal', {
      p_share_token: normalizedToken,
    })

    if (sharedDealError || !sharedDeal) {
      return new Response(JSON.stringify({
        verified: false,
        reason: 'not_found',
        message: "We couldn't authenticate this transaction link. For your safety, do not enter personal information or make any payment through this link.",
      }), { status: 200, headers: cors })
    }

    // Optional caller identification for participant flags (without leaking raw user UUIDs)
    let callerId: string | null = null
    const authHeader = req.headers.get('Authorization')
    const bearer = authHeader?.match(/^Bearer\s+(\S+)$/i)?.[1]
    if (bearer) {
      const { data: userRes } = await supabase.auth.getUser(bearer)
      callerId = userRes?.user?.id || null
    }

    const isCreator = Boolean(
      callerId && (
        (sharedDeal.creator_role === 'BUYER' && callerId === sharedDeal.buyer_id)
        || (sharedDeal.creator_role === 'SELLER' && callerId === sharedDeal.seller_id)
      )
    )
    const isCounterparty = Boolean(
      callerId && (
        (sharedDeal.creator_role === 'BUYER' && callerId === sharedDeal.seller_id)
        || (sharedDeal.creator_role === 'SELLER' && callerId === sharedDeal.buyer_id)
      )
    )
    const counterpartyFilled = sharedDeal.creator_role === 'BUYER'
      ? Boolean(sharedDeal.seller_id)
      : Boolean(sharedDeal.buyer_id)

    return new Response(JSON.stringify({
      verified: true,
      reason: 'valid',
      deal_title: data.deal_title,
      deal_amount: data.deal_amount,
      deal_status: data.deal_status,
      creator_role: data.creator_role,
      message: data.message,
      deal: {
        ...(isCreator || isCounterparty ? { id: sharedDeal.id } : {}),
        title: sharedDeal.title,
        description: sharedDeal.description,
        amount: sharedDeal.amount,
        creator_role: sharedDeal.creator_role,
        status: sharedDeal.status,
        buyer_name: sharedDeal.buyer_name || null,
        seller_name: sharedDeal.seller_name || null,
        counterparty_filled: counterpartyFilled,
        is_creator: isCreator,
        is_counterparty: isCounterparty,
      },
    }), { status: 200, headers: cors })
  } catch (err) {
    console.error('[verify-link] Unexpected error:', err)
    return new Response(JSON.stringify({
      verified: false,
      reason: 'error',
      message: 'An unexpected error occurred during verification.',
    }), { status: 500, headers: cors })
  }
})
