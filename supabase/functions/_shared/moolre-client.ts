const MOOLRE_API_USER = Deno.env.get('MOOLRE_API_USER')!
const MOOLRE_PUBLIC_KEY = Deno.env.get('MOOLRE_PUBLIC_KEY')!
const MOOLRE_PRIVATE_KEY = Deno.env.get('MOOLRE_PRIVATE_KEY')!
const MOOLRE_ACCOUNT_NUMBER = Deno.env.get('MOOLRE_ACCOUNT_NUMBER')!
const MOOLRE_BASE_URL = Deno.env.get('MOOLRE_BASE_URL') || 'https://api.moolre.com'

export interface InitPaymentParams {
  amount: string
  email: string
  externalRef: string
  callbackUrl: string
  redirectUrl: string
  metadata?: Record<string, unknown>
}

export interface InitPaymentResult {
  success: boolean
  authorization_url?: string
  reference?: string
  error?: string
}

export async function initPayment(params: InitPaymentParams): Promise<InitPaymentResult> {
  const res = await fetch(`${MOOLRE_BASE_URL}/embed/link`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-USER': MOOLRE_API_USER,
      'X-API-PUBKEY': MOOLRE_PUBLIC_KEY,
    },
    body: JSON.stringify({
      type: 1,
      amount: params.amount,
      email: params.email,
      currency: 'GHS',
      externalref: params.externalRef,
      callback: params.callbackUrl,
      redirect: params.redirectUrl,
      reusable: '0',
      accountnumber: MOOLRE_ACCOUNT_NUMBER,
      metadata: params.metadata || {},
    }),
  })

  const data = await res.json()

  if (!res.ok || data.status !== 1) {
    return {
      success: false,
      error: data.message || 'Failed to initialize payment with Moolre',
    }
  }

  return {
    success: true,
    authorization_url: data.data?.authorization_url,
    reference: data.data?.reference || params.externalRef,
  }
}

export interface VerifyPaymentResult {
  success: boolean
  status?: string
  error?: string
}

export async function verifyPayment(reference: string): Promise<VerifyPaymentResult> {
  const res = await fetch(`${MOOLRE_BASE_URL}/open/transact/status`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-USER': MOOLRE_API_USER,
      'X-API-PUBKEY': MOOLRE_PUBLIC_KEY,
    },
    body: JSON.stringify({
      type: 1,
      idtype: '1',
      id: reference,
      accountnumber: MOOLRE_ACCOUNT_NUMBER,
    }),
  })

  const data = await res.json()

  const isSuccessful = data.status === 1 || data.status === '1'

  if (!res.ok) {
    return {
      success: false,
      error: data.message || 'Payment verification failed',
    }
  }

  return {
    success: isSuccessful,
    status: data.status?.toString(),
  }
}

export interface SendPayoutParams {
  amount: number
  recipientPhone: string
  network: string
  narration: string
  reference: string
}

export interface SendPayoutResult {
  success: boolean
  reference?: string
  error?: string
}

const NETWORK_CHANNEL: Record<string, string> = {
  mtn: '1',
  vodafone: '6',
  tigo: '7',
}

export async function sendPayout(params: SendPayoutParams): Promise<SendPayoutResult> {
  const channel = NETWORK_CHANNEL[params.network.toLowerCase()]
  if (!channel) {
    return { success: false, error: `Unsupported network: ${params.network}` }
  }

  const res = await fetch(`${MOOLRE_BASE_URL}/open/transact/transfer`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-USER': MOOLRE_API_USER,
      'X-API-KEY': MOOLRE_PRIVATE_KEY,
    },
    body: JSON.stringify({
      type: 1,
      channel,
      currency: 'GHS',
      amount: params.amount.toString(),
      receiver: params.recipientPhone,
      externalref: params.reference,
      accountnumber: MOOLRE_ACCOUNT_NUMBER,
      reference: params.narration,
    }),
  })

  const data = await res.json()

  if (!res.ok || data.status !== '1') {
    return {
      success: false,
      error: data.message || data.error || 'Transfer failed',
    }
  }

  return {
    success: true,
    reference: data.data?.externalref || params.reference,
  }
}
