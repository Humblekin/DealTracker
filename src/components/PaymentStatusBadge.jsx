import { PAYMENT_STATUS_CONFIG } from '../utils/constants';

export default function PaymentStatusBadge({ status, emptyLabel = '—' }) {
  if (!status) {
    return (
      <span className="badge badge-refunded">
        <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#6b7280', display: 'inline-block' }}></span>
        {emptyLabel}
      </span>
    );
  }

  const config = PAYMENT_STATUS_CONFIG[status] || { label: status, color: '#6b7280', bg: 'rgba(107,114,128,0.15)' };

  return (
    <span className="badge" style={{ background: config.bg, color: config.color, borderColor: `${config.color}33` }}>
      <span style={{ width: 6, height: 6, borderRadius: '50%', background: config.color, display: 'inline-block' }}></span>
      {config.label}
    </span>
  );
}
