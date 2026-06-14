const ALLOWED_ORIGINS = [
  'http://localhost:5173',
  'http://localhost:5174',
  'http://localhost:4173',
  'https://dealtracker.vercel.app',
  'https://dealtracke.netlify.app',
  'https://dealguider.netlify.app',
]

export function corsHeaders(origin: string | null): Record<string, string> {
  const allowed = ALLOWED_ORIGINS.includes(origin || '') ? origin! : ALLOWED_ORIGINS[0]
  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Api-Key, X-Idempotency-Key',
    'Access-Control-Max-Age': '86400',
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
