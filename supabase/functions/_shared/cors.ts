import { getAllowedProdDomains, isAllowedDomain } from './linkguard.ts'

export function corsHeaders(origin: string | null): Record<string, string> {
  const prodDomains = getAllowedProdDomains()
  const defaultOrigin = prodDomains.length > 0
    ? `https://${prodDomains[0]}`
    : 'https://dealguider.netlify.app'
  const allowed = origin && isAllowedDomain(origin) ? origin : defaultOrigin

  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
    // X-Client-Info is sent by the supabase-js browser client on every
    // request; without it the browser preflight fails and invocations
    // throw "Failed to send a request to the Edge Function".
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, apikey, X-Api-Key, X-Idempotency-Key, X-Client-Info',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
    'Content-Type': 'application/json',
  }
}

export function handleCors(req: Request): Response | null {
  if (req.method === 'OPTIONS') {
    const origin = req.headers.get('Origin')
    return new Response(null, { status: 204, headers: corsHeaders(origin) })
  }
  return null
}

export function methodNotAllowed(req: Request): Response {
  const origin = req.headers.get('Origin')
  return new Response(JSON.stringify({ error: 'Method not allowed' }), {
    status: 405,
    headers: corsHeaders(origin),
  })
}
