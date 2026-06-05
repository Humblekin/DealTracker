import { Link } from 'react-router-dom';
import StatusBadge from './StatusBadge';
import { formatGHS } from '../utils/fees';
import './DealCard.css';

export default function DealCard({ deal, userId }) {
  const isBuyerForDeal = deal.buyer_id === userId;
  const isSellerForDeal = deal.seller_id === userId;

  const otherParty = deal.buyer_id && deal.seller_id
    ? (isBuyerForDeal
        ? deal.seller_profile?.full_name || 'Seller'
        : deal.buyer_profile?.full_name || 'Buyer')
    : deal.creator_role
        ? `Awaiting ${deal.creator_role === 'BUYER' ? 'Seller' : 'Buyer'}...`
        : 'Awaiting counterparty...';

  const otherLabel = isBuyerForDeal ? 'Seller' : (isSellerForDeal ? 'Buyer' : 'Counterparty');

  const isAwaitingCounterparty = deal.status === 'AWAITING_COUNTERPARTY';
  const isCreator = isAwaitingCounterparty && (
    (deal.creator_role === 'BUYER' && isBuyerForDeal) ||
    (deal.creator_role === 'SELLER' && isSellerForDeal)
  );
  const isActionNeeded = isCreator || (isBuyerForDeal && deal.status === 'AWAITING_PAYMENT') || (!isBuyerForDeal && !isSellerForDeal && deal.status === 'IN_ESCROW');

  return (
    <Link to={`/deals/${deal.id}`} className={`deal-card ${isActionNeeded ? 'deal-action-needed' : ''}`}>
      <div className="deal-card-header">
        <div className="deal-card-title-row">
          <h3>{deal.title || 'Untitled Deal'}</h3>
          <p className="deal-card-amount">{formatGHS(deal.amount)}</p>
        </div>
        <StatusBadge status={deal.status} />
      </div>
      
      {deal.description && (
        <p className="deal-card-desc">{deal.description}</p>
      )}
      
      <div className="deal-card-footer">
        <div className="deal-meta-group">
          <div className="deal-meta-item">
            <span className="meta-label">{otherLabel}</span>
            <span className="meta-value">{otherParty}</span>
          </div>
          <div className="deal-meta-item">
            <span className="meta-label">Created</span>
            <span className="meta-value">
              {new Date(deal.created_at).toLocaleDateString('en-GH', {
                day: 'numeric', month: 'short', year: 'numeric'
              })}
            </span>
          </div>
        </div>
        <div className="deal-card-arrow">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
        </div>
      </div>
    </Link>
  );
}
