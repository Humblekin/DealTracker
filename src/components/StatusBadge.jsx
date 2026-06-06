import { STATUS_CONFIG } from '../utils/constants';

const ROLE_LABELS = {
  AWAITING_PAYMENT: {
    buyer: 'Awaiting Your Payment',
    seller: 'Awaiting Payment',
  },
};

export default function StatusBadge({ status, role }) {
  const config = STATUS_CONFIG[status] || { label: status, color: '#6b7280', bg: 'rgba(107,114,128,0.15)' };

  const badgeClass = {
    AWAITING_PAYMENT: 'badge-pending',
    IN_ESCROW: 'badge-escrow',
    DELIVERED: 'badge-funded',
    COMPLETED: 'badge-completed',
    DISPUTED: 'badge-dispute',
    REFUNDED: 'badge-refunded',
    CANCELLED: 'badge-pending',
  }[status] || '';

  const label = (role && ROLE_LABELS[status]?.[role]) || config.label;

  return (
    <span className={`badge ${badgeClass}`}>
      <span style={{ width: 6, height: 6, borderRadius: '50%', background: config.color, display: 'inline-block' }}></span>
      {label}
    </span>
  );
}
