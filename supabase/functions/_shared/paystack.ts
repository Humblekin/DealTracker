// ---------------------------------------------------------------
// Paystack client — shared across all edge functions.
// Handles transaction initialization, verification, webhook
// signature validation, and transfers (recipient + transfer).
// Amounts are converted to the smallest currency unit (pesewas).
// ---------------------------------------------------------------

const PAYSTACK_BASE_URL = Deno.env.get('PAYSTACK_BASE_URL') || 'https://api.paystack.co'
const PAYSTACK_SECRET_KEY = Deno.env.get('PAYSTACK_SECRET_KEY')!

// Ghana mobile-money networks → Paystack bank codes
const NETWORK_BANK_CODE: Record<string, string> = {
  mtn: 'MTN',
  vodafone: 'VODAFONE',
  tigo: 'ATL',
  atl: 'ATL',
  airteltigo: 'ATL',
}

export function toPesewas(amount: number): number {
  return Math.round(amount * 100)
}

export function fromPesewas(amount: number): number {
  return amount / 100
}

export function networkBankCode(network: string): string | null {
  return NETWORK_BANK_CODE[network.toLowerCase()] || null
}

async function paystackFetch(path: string, init?: RequestInit): Promise<{ ok: boolean; status: number; data: unknown }> {
  const res = await fetch(`${PAYSTACK_BASE_URL}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`,
      ...(init?.headers || {}),
    },
  })

  let body: unknown = {}
  try {
    body = await res.json()
  } catch {
    body = {}
  }

  return { ok: res.ok, status: res.status, data: body }
}

export interface InitPaymentParams {
  amount: string
  email: string
  reference: string
  callbackUrl: string
  metadata?: Record<string, unknown>
}

export interface InitPaymentResult {
  success: boolean
  authorization_url?: string
  access_code?: string
  reference?: string
  error?: string
}

// POST /transaction/initialize — creates a Paystack checkout session
export async function initPayment(params: InitPaymentParams): Promise<InitPaymentResult> {
  const res = await paystackFetch('/transaction/initialize', {
    method: 'POST',
    body: JSON.stringify({
      amount: toPesewas(parseFloat(params.amount)),
      email: params.email,
      reference: params.reference,
      callback_url: params.callbackUrl,
      metadata: params.metadata || {},
      channels: ['card', 'mobile_money', 'bank', 'ussd'],
    }),
  })

  const data = res.data as {
    status?: boolean
    message?: string
    data?: { authorization_url?: string; access_code?: string; reference?: string }
  }

  if (!res.ok || data?.status !== true || !data.data?.authorization_url) {
    return {
      success: false,
      error: data?.message || 'Failed to initialize payment with Paystack',
    }
  }

  return {
    success: true,
    authorization_url: data.data.authorization_url,
    access_code: data.data.access_code,
    reference: data.data.reference || params.reference,
  }
}

export interface VerifyPaymentResult {
  success: boolean
  status?: string
  amount?: number
  reference?: string
  gateway_response?: string
  error?: string
}

// GET /transaction/verify/:reference — authoritative payment status from Paystack
export async function verifyPayment(reference: string): Promise<VerifyPaymentResult> {
  const res = await paystackFetch(`/transaction/verify/${encodeURIComponent(reference)}`)

  const data = res.data as {
    status?: boolean
    message?: string
    data?: {
      status?: string
      amount?: number
      reference?: string
      gateway_response?: string
    }
  }

  if (!res.ok || data?.status !== true || !data.data) {
    return {
      success: false,
      error: data?.message || 'Payment verification failed',
    }
  }

  const status = data.data.status?.trim().toLowerCase()

  return {
    success: status === 'success',
    status,
    amount: data.data.amount,
    reference: data.data.reference,
    gateway_response: data.data.gateway_response,
  }
}

// HMAC-SHA512 webhook signature verification (X-Paystack-Signature)
export async function verifyWebhookSignature(
  rawBody: string,
  signature: string | null,
  secret: string
): Promise<boolean> {
  if (!signature || !secret) return false

  const keyBytes = new TextEncoder().encode(secret)
  const msgBytes = new TextEncoder().encode(rawBody)
  const key = await crypto.subtle.importKey('raw', keyBytes, { name: 'HMAC', hash: 'SHA-512' }, false, ['sign'])
  const mac = await crypto.subtle.sign('HMAC', key, msgBytes)
  const macHex = Array.from(new Uint8Array(mac)).map(b => b.toString(16).padStart(2, '0')).join('')

  return macHex === signature.toLowerCase()
}

export interface CreateRecipientParams {
  name: string
  phone: string
  network: string
}

export interface CreateRecipientResult {
  success: boolean
  recipient_code?: string
  error?: string
}

// POST /transferrecipient — creates a mobile-money recipient for payouts
export async function createTransferRecipient(params: CreateRecipientParams): Promise<CreateRecipientResult> {
  const bankCode = networkBankCode(params.network)
  if (!bankCode) {
    return { success: false, error: `Unsupported network: ${params.network}` }
  }

  const res = await paystackFetch('/transferrecipient', {
    method: 'POST',
    body: JSON.stringify({
      type: 'mobile_money',
      name: params.name,
      account_number: params.phone,
      bank_code: bankCode,
      currency: 'GHS',
      country: 'GH',
    }),
  })

  const data = res.data as { status?: boolean; message?: string; data?: { recipient_code?: string } }

  if (!res.ok || data?.status !== true || !data.data?.recipient_code) {
    return {
      success: false,
      error: data?.message || 'Failed to create transfer recipient',
    }
  }

  return {
    success: true,
    recipient_code: data.data.recipient_code,
  }
}

export interface TransferParams {
  amount: number
  recipientCode: string
  reason: string
  reference: string
}

export interface TransferResult {
  success: boolean
  transfer_code?: string
  reference?: string
  error?: string
}

// POST /transfer — initiates a payout from the Paystack balance
export async function initiateTransfer(params: TransferParams): Promise<TransferResult> {
  const res = await paystackFetch('/transfer', {
    method: 'POST',
    body: JSON.stringify({
      source: 'balance',
      amount: toPesewas(params.amount),
      recipient: params.recipientCode,
      reason: params.reason,
      reference: params.reference,
    }),
  })

  const data = res.data as { status?: boolean; message?: string; data?: { transfer_code?: string; reference?: string } }

  if (!res.ok || data?.status !== true || !data.data) {
    return {
      success: false,
      error: data?.message || 'Transfer failed',
    }
  }

  return {
    success: true,
    transfer_code: data.data.transfer_code,
    reference: data.data.reference || params.reference,
  }
}

export interface VerifyTransferResult {
  success: boolean
  status?: string
  reference?: string
  error?: string
}

// GET /transfer/verify/:reference — payout status
export async function verifyTransfer(reference: string): Promise<VerifyTransferResult> {
  const res = await paystackFetch(`/transfer/verify/${encodeURIComponent(reference)}`)

  const data = res.data as { status?: boolean; message?: string; data?: { status?: string; reference?: string } }

  if (!res.ok || data?.status !== true || !data.data) {
    return {
      success: false,
      error: data?.message || 'Transfer verification failed',
    }
  }

  return {
    success: data.data.status === 'success',
    status: data.data.status,
    reference: data.data.reference,
  }
}
