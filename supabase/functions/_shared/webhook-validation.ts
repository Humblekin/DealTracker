function isPublicIpv4(address: string): boolean {
  const octets = address.split('.').map(Number)
  if (octets.length !== 4 || octets.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return false
  }

  const [a, b, c] = octets
  if (a === 0 || a === 10 || a === 127 || a >= 224) return false
  if (a === 169 && b === 254) return false
  if (a === 172 && b >= 16 && b <= 31) return false
  if (a === 192 && (b === 168 || (b === 0 && c === 0) || (b === 0 && c === 2))) return false
  if (a === 100 && b >= 64 && b <= 127) return false
  if (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) return false
  if (a === 203 && b === 0 && c === 113) return false
  if (a === 255) return false
  return true
}

function isPublicIpv6(address: string): boolean {
  const normalized = address.toLowerCase()
  const firstGroup = Number.parseInt(normalized.split(':')[0] || '0', 16)
  return firstGroup >= 0x2000
    && firstGroup <= 0x3fff
    && !normalized.startsWith('2001:db8:')
}

export function isPublicWebhookAddress(address: string): boolean {
  return address.includes(':') ? isPublicIpv6(address) : isPublicIpv4(address)
}

export async function validateWebhookUrl(rawUrl: string): Promise<string> {
  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    throw new Error('Webhook URL must be a valid HTTPS URL')
  }

  const hostname = url.hostname.toLowerCase()
  if (
    url.protocol !== 'https:'
    || url.username
    || url.password
    || (url.port && url.port !== '443')
    || hostname === 'localhost'
    || hostname.endsWith('.localhost')
    || hostname.endsWith('.local')
    || hostname.endsWith('.internal')
    || hostname.includes(':')
    || /^\d{1,3}(\.\d{1,3}){3}$/.test(hostname)
  ) {
    throw new Error('Webhook URL must use HTTPS and a public DNS hostname')
  }
  if (!/^[a-z0-9.-]+$/.test(hostname) || hostname.startsWith('.') || hostname.endsWith('.')) {
    throw new Error('Webhook URL must use a public DNS hostname')
  }

  let ipv4: string[]
  try {
    ipv4 = await Deno.resolveDns(hostname, 'A')
  } catch {
    throw new Error('Webhook hostname did not resolve to a public address')
  }
  if (ipv4.length === 0 || ipv4.some((address) => !isPublicWebhookAddress(address))) {
    throw new Error('Webhook hostname must resolve only to public addresses')
  }

  try {
    const ipv6 = await Deno.resolveDns(hostname, 'AAAA')
    if (ipv6.some((address) => !isPublicWebhookAddress(address))) {
      throw new Error('Webhook hostname must resolve only to public addresses')
    }
  } catch (error) {
    if (error instanceof Error && error.message.includes('public addresses')) throw error
  }

  return url.toString()
}
