import { supabase } from './supabase';
import { PAYSTACK_PUBLIC_KEY } from '../utils/constants';
import { getPaystackPop } from './paystack';

// ---------------------------------------------------------------
// paystackService — single frontend boundary for all Paystack
// interactions. Edge functions are the source of truth; the client
// only ever handles the Paystack public key + access code.
// ---------------------------------------------------------------

async function authedFetch(url, body) {
  const { data: { session } } = await supabase.auth.getSession();
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session?.access_token}`,
    },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

// Step 1 — server initializes a Paystack checkout session
export async function initializePayment({ dealId, redirectUrl }) {
  return authedFetch(
    `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/paystack-init-payment`,
    { deal_id: dealId, redirect_url: redirectUrl }
  );
}

// Step 2 — verify a deal's payment status against Paystack (idempotent)
export async function verifyDealPayment(dealId) {
  return authedFetch(
    `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/paystack-verify`,
    { deal_id: dealId }
  );
}

// Step 3 — open the Paystack Inline popup for the initialized session
export async function openPaystackCheckout({ accessCode }) {
  if (!PAYSTACK_PUBLIC_KEY) {
    throw new Error('Paystack public key is not configured. Set VITE_PAYSTACK_PUBLIC_KEY in your .env file.');
  }

  const PaystackPop = await getPaystackPop();

  const popup = new PaystackPop();
  popup.resumeTransaction(accessCode);
}
