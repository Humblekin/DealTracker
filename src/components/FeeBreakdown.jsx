import { formatGHS } from '../utils/fees';
import './FeeBreakdown.css';

export default function FeeBreakdown({ fees, expanded = false }) {
  if (!fees) return null;

  return (
    <div className="fee-breakdown">
      <div className="fee-row">
        <span className="fee-label">Deal Amount</span>
        <span className="fee-value">{formatGHS(fees.dealAmount)}</span>
      </div>
      <div className="fee-row sub">
        <span className="fee-label">Moolre Processing Fee</span>
        <span className="fee-value dim">Included</span>
      </div>
      <div className="fee-row sub">
        <span className="fee-label">Platform Fee (2%)</span>
        <span className="fee-value dim">+ {formatGHS(fees.platformFee)}</span>
      </div>
      <div className="fee-divider"></div>
      <div className="fee-row total">
        <span className="fee-label">Total Payable</span>
        <span className="fee-value highlight">{formatGHS(fees.totalPayable)}</span>
      </div>
      {expanded && (
        <>
          <div className="fee-divider"></div>
          <div className="fee-row sub">
            <span className="fee-label">Transfer Fee (est.)</span>
            <span className="fee-value dim">- {formatGHS(fees.transferFee)}</span>
          </div>
          <div className="fee-row">
            <span className="fee-label">Seller Receives</span>
            <span className="fee-value success">{formatGHS(fees.sellerReceives)}</span>
          </div>
        </>
      )}
    </div>
  );
}
