import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.106.2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

export interface WebhookPayload {
  event: string
  transaction_id: string
  merchant_id: string
  deal_id: string | null
  merchant_order_id: string
  status: string
  amount: number
  currency: string
  timestamp: string
}

export async function deliverWebhook(
  merchantId: string,
  webhookUrl: string,
  webhookSecret: string,
  payload: WebhookPayload,
  transactionId: string | null
): Promise<void> {
  const body = JSON.stringify(payload)
  const timestamp = Date.now().toString()

  // HMAC-SHA256 signature
  const keyBytes = new TextEncoder().encode(webhookSecret)
  const msgBytes = new TextEncoder().encode(timestamp + '.' + body)
  const key = await crypto.subtle.importKey('raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const signature = await crypto.subtle.sign('HMAC', key, msgBytes)
  const sigHex = Array.from(new Uint8Array(signature)).map(b => b.toString(16).padStart(2, '0')).join('')

  let responseStatus: number | null = null
  let responseBody: string | null = null

  try {
    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-DealGuider-Signature': `t=${timestamp},v1=${sigHex}`,
        'User-Agent': 'DealGuider-Webhook/1.0',
      },
      body,
    })
    responseStatus = res.status
    responseBody = await res.text()
  } catch (err) {
    responseStatus = 0
    responseBody = err instanceof Error ? err.message : 'Connection failed'
  }

  // Log delivery attempt
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  await supabase.from('merchant_webhook_logs').insert({
    merchant_id: merchantId,
    transaction_id: transactionId,
    event: payload.event,
    url: webhookUrl,
    payload,
    response_status: responseStatus,
    response_body: responseBody,
  })
}
