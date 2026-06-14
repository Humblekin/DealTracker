import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.106.2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

interface AuthResult {
  merchantId: string
  merchant: {
    id: string
    name: string
    email: string
    webhook_url: string | null
    webhook_secret: string
    is_active: boolean
    settings: Record<string, unknown>
  }
  keyId: string
}

export async function authenticateMerchant(apiKey: string): Promise<AuthResult> {
  if (!apiKey) {
    throw new AuthError('API key is required')
  }

  // API keys are formatted as: dg_prefix_secret
  const parts = apiKey.split('_')
  if (parts.length < 3 || parts[0] !== 'dg' || !parts[1]) {
    throw new AuthError('Invalid API key format')
  }

  const prefix = parts[1]
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  // Find the key by prefix
  const { data: keys, error: keyError } = await supabase
    .from('merchant_api_keys')
    .select('id, key_hash, merchant_id, is_active')
    .eq('key_prefix', prefix)
    .eq('is_active', true)

  if (keyError || !keys || keys.length === 0) {
    throw new AuthError('Invalid API key')
  }

  // Hash the provided key and compare
  const fullKeyBytes = new TextEncoder().encode(apiKey)
  const hashBuffer = await crypto.subtle.digest('SHA-256', fullKeyBytes)
  const hashArray = Array.from(new Uint8Array(hashBuffer))
  const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('')

  let matchedKey = null
  for (const key of keys) {
    if (key.key_hash === hashHex) {
      matchedKey = key
      break
    }
  }

  if (!matchedKey) {
    throw new AuthError('Invalid API key')
  }

  // Fetch merchant details
  const { data: merchant, error: merchantError } = await supabase
    .from('merchants')
    .select('*')
    .eq('id', matchedKey.merchant_id)
    .single()

  if (merchantError || !merchant) {
    throw new AuthError('Merchant not found')
  }

  if (!merchant.is_active) {
    throw new AuthError('Merchant account is inactive')
  }

  // Update last_used_at
  await supabase
    .from('merchant_api_keys')
    .update({ last_used_at: new Date().toISOString() })
    .eq('id', matchedKey.id)

  return {
    merchantId: merchant.id,
    merchant: {
      id: merchant.id,
      name: merchant.name,
      email: merchant.email,
      webhook_url: merchant.webhook_url,
      webhook_secret: merchant.webhook_secret,
      is_active: merchant.is_active,
      settings: merchant.settings || {},
    },
    keyId: matchedKey.id,
  }
}

export class AuthError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AuthError'
  }
}
