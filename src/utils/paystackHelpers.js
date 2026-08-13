import { PAYMENT_STATUS_CONFIG, PAYMENT_STATUS } from './constants';

// Convert a GHS amount to pesewas (smallest Paystack unit)
export function toPesewas(amount) {
  return Math.round((parseFloat(amount) || 0) * 100);
}

// Convert pesewas back to GHS
export function fromPesewas(amount) {
  return (parseFloat(amount) || 0) / 100;
}

// Map a raw Paystack transaction status to our standardized payment status
export function mapPaystackStatus(rawStatus) {
  switch ((rawStatus || '').toLowerCase()) {
    case 'success':
      return PAYMENT_STATUS.SUCCESS;
    case 'abandoned':
      return PAYMENT_STATUS.ABANDONED;
    case 'failed':
      return PAYMENT_STATUS.FAILED;
    case 'reversed':
      return PAYMENT_STATUS.REVERSED;
    case 'processing':
      return PAYMENT_STATUS.PROCESSING;
    case 'pending':
      return PAYMENT_STATUS.PENDING;
    default:
      return PAYMENT_STATUS.INITIALIZED;
  }
}

// Get display config for a standardized payment status
export function getPaymentStatusConfig(status) {
  return PAYMENT_STATUS_CONFIG[status] || PAYMENT_STATUS_CONFIG.INITIALIZED;
}

export { PAYMENT_STATUS, PAYMENT_STATUS_CONFIG };
