import { useState, useCallback } from 'react';
import { initializePayment, verifyDealPayment, openPaystackCheckout } from '../lib/paystackService';

// Hook that wraps the full Paystack payment flow for a deal.
// Returns { paying, startPayment, checkPayment }.
export function usePaystackPayment() {
  const [paying, setPaying] = useState(false);
  const [checking, setChecking] = useState(false);

  // Initialize a checkout session and open the Paystack Inline popup.
  // onPaid is invoked after Paystack confirms success on the client.
  const startPayment = useCallback(async ({ deal, onPaid, onAbandoned }) => {
    setPaying(true);
    try {
      const session = await initializePayment({
        dealId: deal.id,
        redirectUrl: `${window.location.origin}/deals/${deal.id}`,
      });

      await openPaystackCheckout({
        accessCode: session.access_code,
        reference: session.reference,
        email: deal.buyer_profile?.email,
        amount: parseFloat(deal.amount),
        onSuccess: () => onPaid?.(session.reference),
        onClose: () => onAbandoned?.(),
      });
    } finally {
      setPaying(false);
    }
  }, []);

  // Re-check payment status against Paystack (used by the
  // "Check Payment Status" action).
  const checkPayment = useCallback(async (dealId) => {
    setChecking(true);
    try {
      return await verifyDealPayment(dealId);
    } finally {
      setChecking(false);
    }
  }, []);

  return { paying, checking, startPayment, checkPayment };
}
