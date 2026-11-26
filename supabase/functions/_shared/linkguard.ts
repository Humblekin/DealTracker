// Shared LinkGuard validation & cryptographic helpers
// Compatible with both Deno (Edge Functions) and Node (test runner).

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const DEFAULT_PROD_DOMAINS = [
  'dealguider.netlify.app',
  'dealtracke.netlify.app',
  'dealtracker.vercel.app',
]

const DEV_HOSTS = ['localhost', '127.0.0.1']

function getEnv(name: string): string | undefined {
  const denoEnv = (globalThis as { Deno?: { env?: { get?: (key: string) => string | undefined } } }).Deno?.env
  if (denoEnv?.get) return denoEnv.get(name)
  const nodeEnv = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env
  return nodeEnv?.[name]
}

export function getAllowedProdDomains(): string[] {
  const configured = getEnv('LINKGUARD_ALLOWED_DOMAINS')
  if (!configured) return DEFAULT_PROD_DOMAINS
  return configured
    .split(',')
    .map((d) => d.trim().toLowerCase())
    .filter(Boolean)
}

export function isDevOriginsAllowed(): boolean {
  const explicit = getEnv('LINKGUARD_ALLOW_DEV_ORIGINS')
  if (explicit === 'true') return true
  if (explicit === 'false') return false
  // Fail closed when deployed in cloud Edge Runtime unless explicitly opted in;
  // allow local dev/test runs where DENO_DEPLOYMENT_ID is unset.
  return !getEnv('DENO_DEPLOYMENT_ID')
}

export function isValidShareTokenFormat(token: unknown): token is string {
  return typeof token === 'string' && UUID_RE.test(token.trim())
}

export function isAllowedDomain(
  origin: string | null | undefined,
  options?: { allowedProdDomains?: string[]; allowDev?: boolean }
): boolean {
  if (!origin || typeof origin !== 'string') return false
  try {
    const url = new URL(origin)
    const host = url.hostname.toLowerCase()
    const prodDomains = options?.allowedProdDomains ?? getAllowedProdDomains()
    const allowDev = options?.allowDev ?? isDevOriginsAllowed()

    if (prodDomains.includes(host)) {
      return url.protocol === 'https:'
    }

    if (allowDev && DEV_HOSTS.includes(host)) {
      return url.protocol === 'http:' || url.protocol === 'https:'
    }

    return false
  } catch {
    return false
  }
}

export function areOriginsConsistent(
  headerOrigin: string | null,
  clientOrigin: string | null | undefined
): boolean {
  if (!headerOrigin || !clientOrigin) return false
  try {
    return new URL(headerOrigin).origin === new URL(clientOrigin).origin
  } catch {
    return false
  }
}

export function extractClientIp(headers: Headers): string {
  const cfIp = headers.get('cf-connecting-ip')?.trim()
  if (cfIp) return cfIp

  const realIp = headers.get('x-real-ip')?.trim()
  if (realIp) return realIp

  const forwarded = headers.get('x-forwarded-for')
  if (forwarded) {
    // Use the rightmost entry added by the trusted edge proxy rather than
    // the client-spoofable leftmost value.
    const parts = forwarded.split(',').map((p) => p.trim()).filter(Boolean)
    if (parts.length > 0) return parts[parts.length - 1]
  }

  return 'unknown'
}

export async function hashShareToken(token: string): Promise<string> {
  const normalized = token.trim().toLowerCase()
  const bytes = new TextEncoder().encode(normalized)
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}
