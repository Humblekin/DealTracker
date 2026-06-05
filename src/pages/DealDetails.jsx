import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';
import StatusBadge from '../components/StatusBadge';
import FeeBreakdown from '../components/FeeBreakdown';
import { formatGHS } from '../utils/fees';
import { DEAL_STATUS } from '../utils/constants';
import toast from 'react-hot-toast';
import './DealDetails.css';

export default function DealDetails() {
  const { id } = useParams();
  const { profile } = useAuth();
  const navigate = useNavigate();
  const [deal, setDeal] = useState(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [disputeReason, setDisputeReason] = useState('');
  const [showDisputeForm, setShowDisputeForm] = useState(false);
  const [buyerConfirmed, setBuyerConfirmed] = useState(false);

  useEffect(() => { fetchDeal(); }, [id]);

  async function fetchDeal() {
    try {
      const { data, error } = await supabase.from('deals')
        .select('*, payments(*), disputes(*)')
        .eq('id', id).single();
      if (error) throw error;
      setDeal(data);

      const { data: logs } = await supabase.from('audit_logs')
        .select('action')
        .eq('deal_id', id)
        .in('action', ['DELIVERY_CONFIRMED', 'FUNDS_TRANSFERRED'])
        .limit(1);
      setBuyerConfirmed(logs && logs.length > 0);
    } catch (err) { toast.error('Deal not found'); navigate('/dashboard'); }
    finally { setLoading(false); }
  }

  async function handlePayment() {
    setActionLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/moolre-init-payment`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${session?.access_token}`,
          },
          body: JSON.stringify({
            deal_id: deal.id,
            redirect_url: `${window.location.origin}/deals/${deal.id}`,
          }),
        }
      );
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || 'Failed to initiate payment');

      // Redirect to Moolre checkout
      window.location.href = body.authorization_url;
    } catch (err) {
      toast.error(err.message || 'Something went wrong');
    } finally {
      setActionLoading(false);
    }
  }

  async function handleConfirmDelivery() {
    if (!window.confirm('Confirm you have received the item? This will release payment to the seller.')) return;
    setActionLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/confirm-delivery`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${session?.access_token}`,
          },
          body: JSON.stringify({ deal_id: deal.id }),
        }
      );
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || 'Confirmation failed');
      setBuyerConfirmed(true);
      toast.success(body.message || 'Delivery confirmed!');
      fetchDeal();
    } catch (err) {
      toast.error(err.message || 'Something went wrong');
    } finally {
      setActionLoading(false);
    }
  }

  async function handleOpenDispute(e) {
    e.preventDefault();
    if (!disputeReason.trim()) { toast.error('Please provide a reason'); return; }
    setActionLoading(true);
    try {
      await supabase.from('disputes').insert({ deal_id: deal.id, reason: disputeReason, opened_by: profile.id, status: 'OPEN' });
      await supabase.from('deals').update({ status: DEAL_STATUS.DISPUTE_OPEN }).eq('id', deal.id);
      await supabase.from('audit_logs').insert({ deal_id: deal.id, action: 'DISPUTE_OPENED', actor_id: profile.id, details: { reason: disputeReason } });
      toast.success('Dispute opened. Admin will review.');
      setShowDisputeForm(false);
      fetchDeal();
    } catch (err) { toast.error(err.message); }
    finally { setActionLoading(false); }
  }

  if (loading) return <div className="loading-screen"><div className="spinner"></div></div>;
  if (!deal) return null;

  const isBuyer = profile?.id === deal.buyer_id;
  const isSeller = profile?.id === deal.seller_id;

  return (
    <div className="page-wrapper deal-details-page">
      <div className="container-md">
        
        <div className="deal-detail-header-wrap glass-card">
          <div className="deal-detail-header">
            <div className="deal-header-info">
              <h1>{deal.title}</h1>
              <div className="deal-header-meta">
                <StatusBadge status={deal.status} />
                <span className="deal-date">{new Date(deal.created_at).toLocaleDateString('en-GH', { year: 'numeric', month: 'long', day: 'numeric' })}</span>
              </div>
            </div>
            <div className="deal-header-amount">
              <span className="amount-label">Principal Amount</span>
              <p className="deal-amount-val">{formatGHS(deal.amount)}</p>
            </div>
          </div>
        </div>

        <div className="deal-detail-grid">
          <div className="deal-detail-main">
            <div className="glass-card">
              <h3 className="detail-section-title">Contract Terms</h3>
              {deal.description ? (
                <p className="deal-description">{deal.description}</p>
              ) : (
                <p className="deal-description text-muted">No specific terms provided.</p>
              )}
              
              <div className="parties-grid">
                <div className="party-card">
                  <span className="party-role">Buyer</span>
                  <span className="party-name">{deal.buyer_profile?.full_name}</span>
                </div>
                <div className="party-card">
                  <span className="party-role">Seller</span>
                  <span className="party-name">{deal.seller_profile?.full_name}</span>
                </div>
              </div>
            </div>

            {deal.disputes?.length > 0 && (
              <div className="glass-card dispute-details-card">
                <h3 className="detail-section-title text-danger">Dispute Information</h3>
                <div className="dispute-list">
                  {deal.disputes.map(d => (
                    <div key={d.id} className="dispute-item">
                      <div className="dispute-reason">
                        <span className="dispute-label">Reason</span>
                        <p>{d.reason}</p>
                      </div>
                      <div className="dispute-meta">
                        <span className={`badge ${d.status === 'OPEN' ? 'badge-dispute' : 'badge-completed'}`}>{d.status}</span>
                        {d.admin_decision && <span className="dispute-decision">Decision: {d.admin_decision}</span>}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className="deal-detail-sidebar">
            <div className="glass-card deal-actions-card">
              <h3 className="detail-section-title">Required Actions</h3>
              
              {deal.status === DEAL_STATUS.PENDING_PAYMENT && isBuyer && (
                <div className="action-wrapper">
                  <p className="action-hint">Fund the escrow to secure this transaction.</p>
                  <button className="btn btn-primary btn-full btn-lg action-btn" onClick={handlePayment} disabled={actionLoading}>
                    {actionLoading ? <><span className="spinner spinner-sm"></span> Initializing...</> : <><span className="btn-icon">💳</span> Pay with Moolre</>}
                  </button>
                </div>
              )}
              
              {deal.status === DEAL_STATUS.IN_ESCROW && isBuyer && !buyerConfirmed && (
                <div className="action-group">
                  <p className="action-hint">Has the seller fulfilled their obligations?</p>
                  <button className="btn btn-success btn-full action-btn" onClick={handleConfirmDelivery} disabled={actionLoading}>
                    {actionLoading ? <><span className="spinner spinner-sm"></span> Processing...</> : <><span className="btn-icon">✅</span> Confirm Satisfactory Delivery</>}
                  </button>
                  <button className="btn btn-outline btn-full action-btn text-danger border-danger" onClick={() => setShowDisputeForm(true)} disabled={actionLoading}>
                    Report an Issue
                  </button>
                </div>
              )}
              
              {deal.status === DEAL_STATUS.IN_ESCROW && isBuyer && buyerConfirmed && (
                <div className="status-notice notice-info">
                  <div className="notice-icon">⏳</div>
                  <div className="notice-content">
                    <h4>Delivery Confirmed</h4>
                    <p>Payout is being sent to the seller.</p>
                  </div>
                </div>
              )}
              
              {deal.status === DEAL_STATUS.IN_ESCROW && isSeller && !buyerConfirmed && (
                <div className="status-notice notice-warning">
                  <div className="notice-icon">⏳</div>
                  <div className="notice-content">
                    <h4>Escrow Funded</h4>
                    <p>Funds are secured. Fulfill the contract and wait for the buyer to confirm delivery.</p>
                  </div>
                </div>
              )}
              
              {deal.status === DEAL_STATUS.IN_ESCROW && isSeller && buyerConfirmed && (
                <div className="status-notice notice-success">
                  <div className="notice-icon">🎉</div>
                  <div className="notice-content">
                    <h4>Delivery Confirmed</h4>
                    <p>The buyer has confirmed delivery. Your payout is being sent to your mobile money.</p>
                  </div>
                </div>
              )}
              
              {deal.status === DEAL_STATUS.COMPLETED && (
                <div className="status-notice notice-success">
                  <div className="notice-icon">✅</div>
                  <div className="notice-content">
                    <h4>Transaction Completed</h4>
                    <p>All obligations fulfilled and funds disbursed.</p>
                  </div>
                </div>
              )}
              
              {deal.status === DEAL_STATUS.DISPUTE_OPEN && (
                <div className="status-notice notice-danger">
                  <div className="notice-icon">⚠️</div>
                  <div className="notice-content">
                    <h4>Dispute Active</h4>
                    <p>This transaction is currently under administrative review.</p>
                  </div>
                </div>
              )}
              
              {deal.status === DEAL_STATUS.PENDING_PAYMENT && isSeller && (
                <div className="status-notice notice-warning">
                  <div className="notice-icon">⏳</div>
                  <div className="notice-content">
                    <h4>Awaiting Funds</h4>
                    <p>Waiting for the buyer to fund the escrow account. Do not provide goods/services yet.</p>
                  </div>
                </div>
              )}
            </div>

            {deal.fee_breakdown && (
              <div className="glass-card">
                <h3 className="detail-section-title">Financial Breakdown</h3>
                <FeeBreakdown fees={deal.fee_breakdown} expanded />
              </div>
            )}
          </div>
        </div>

        {/* Dispute Modal */}
        {showDisputeForm && (
          <div className="modal-overlay" onClick={() => setShowDisputeForm(false)}>
            <div className="modal-content" onClick={e => e.stopPropagation()}>
              <div className="modal-header">
                <h2>Initiate Arbitration</h2>
                <button className="modal-close" onClick={() => setShowDisputeForm(false)}>×</button>
              </div>
              <form onSubmit={handleOpenDispute}>
                <div className="form-group">
                  <label className="form-label">Nature of Dispute</label>
                  <textarea className="form-textarea" value={disputeReason} onChange={e => setDisputeReason(e.target.value)} placeholder="Provide detailed evidence and context for the administrators..." required rows="5" />
                </div>
                <button type="submit" className="btn btn-danger btn-full btn-lg mt-4" disabled={actionLoading}>
                  {actionLoading ? <><span className="spinner spinner-sm"></span>Submitting...</> : 'Submit to Administration'}
                </button>
              </form>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
