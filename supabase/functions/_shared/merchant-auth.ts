import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.106.2'
import { isApiKeyExpired, isMerchantPermissionAllowed } from './merchant-validation.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

export interface AuthResult {
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
  environment: 'test' | 'live'
  permissions: Record<string, unknown>
}

export type MerchantPermission =
  | 'create_escrow'
  | 'verify_payment'
  | 'read_transactions'
  | 'confirm_shipment'
  | 'release_funds'

export async function authenticateMerchant(apiKey: string): Promise<AuthResult> {
  if (!apiKey) {
    throw new AuthError('API key is required')
  }

  const parts = apiKey.split('_')
  if (parts.length < 4 || parts[0] !== 'dg') {
    throw new AuthError('Invalid API key format')
  }

  const environment = parts[1]
  if (environment !== 'test' && environment !== 'live') {
    throw new AuthError('Invalid API key environment')
  }

  const prefix = parts[2]

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  const { data: keys, error: keyError } = await supabase
    .from('merchant_api_keys')
    .select('id, key_hash, merchant_id, is_active, environment, permissions, expires_at')
    .eq('key_prefix', prefix)
    .eq('is_active', true)

  if (keyError || !keys || keys.length === 0) {
    throw new AuthError('Invalid API key')
  }

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

  if (isApiKeyExpired(matchedKey.expires_at)) {
    throw new AuthError('API key has expired')
  }

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

  await supabase
    .from('merchant_api_keys')
    .update({ last_used_at: new Date().toISOString() })
    .eq('id', matchedKey.id)

  let permissions = matchedKey.permissions || {}
  if (typeof permissions === 'string') {
    try {
      permissions = JSON.parse(permissions)
    } catch {
      throw new AuthError('Invalid API key permissions')
    }
  }
  if (!permissions || typeof permissions !== 'object' || Array.isArray(permissions)) {
    throw new AuthError('Invalid API key permissions')
  }

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
    environment: matchedKey.environment,
    permissions,
  }
}

export function requireMerchantPermission(auth: AuthResult, permission: MerchantPermission): void {
  if (!isMerchantPermissionAllowed(auth.permissions, permission)) {
    throw new AuthError(`This API key is not permitted to ${permission.replaceAll('_', ' ')}`)
  }
}

export class AuthError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AuthError'
  }
}
