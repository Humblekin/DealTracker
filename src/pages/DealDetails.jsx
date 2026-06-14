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
  const [deliveryConfirmed, setDeliveryConfirmed] = useState(false);

  useEffect(() => { fetchDeal(); }, [id]);

  async function fetchDeal() {
    try {
      const { data, error } = await supabase.from('deals')
        .select('*, buyer_profile:profiles!buyer_id(full_name), seller_profile:profiles!seller_id(full_name), payments(*), disputes(*)')
        .eq('id', id).single();
      if (error) throw error;
      setDeal(data);

      const { data: logs } = await supabase.from('audit_logs')
        .select('action')
        .eq('deal_id', id)
        .in('action', ['DELIVERY_CONFIRMED', 'FUNDS_TRANSFERRED'])
        .limit(1);
      setDeliveryConfirmed(logs && logs.length > 0);
    } catch (err) { toast.error('Deal not found'); navigate('/dashboard'); }
    finally { setLoading(false); }
  }

  const shareUrl = deal?.share_token ? `${window.location.origin}/deal/${deal.share_token}` : '';

  async function copyShareLink() {
    try {
      await navigator.clipboard.writeText(shareUrl);
      toast.success('Share link copied!');
    } catch { toast.error('Failed to copy link'); }
  }

  async function handlePayment() {
    setActionLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      // Calls the existing Moolre sandbox integration to create a payment link.
      // Edge function moolre-init-payment uses sandbox credentials — no production keys.
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
      const resBody = await res.json();
      if (!res.ok) throw new Error(resBody.error || 'Failed to initiate payment');

      window.location.href = resBody.authorization_url;
    } catch (err) {
      console.error(err);
      toast.error(err.message || 'Something went wrong');
    } finally {
      setActionLoading(false);
    }
  }

  async function handleVerifyPayment() {
    setActionLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      // Reuses the existing Moolre sandbox webhook to verify payment status.
      // The webhook calls Moolre's /open/transact/status to confirm and
      // updates the deal to IN_ESCROW if payment was successful.
      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/moolre-webhook`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${session?.access_token}`,
          },
          body: JSON.stringify({
            externalref: deal.payment_reference,
            data: { reference: deal.moolre_reference || deal.payment_reference },
          }),
        }
      );
      const resBody = await res.json();
      if (resBody.processed) {
        toast.success('Payment confirmed! Funds are now in escrow.');
        fetchDeal();
      } else if (resBody.reason && resBody.reason !== 'Payment not successful') {
        toast(resBody.reason, { icon: 'ℹ️' });
        fetchDeal();
      } else {
        toast.error('Payment has not been completed yet. Please try again shortly.');
      }
    } catch (err) {
      console.error(err);
      toast.error('Failed to check payment status. Please try again.');
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
      const resBody = await res.json();
      if (!res.ok) throw new Error(resBody.error || 'Confirmation failed');
      setDeliveryConfirmed(true);
      toast.success(resBody.message || 'Delivery confirmed!');
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
      await supabase.from('deals').update({ status: DEAL_STATUS.DISPUTED }).eq('id', deal.id);
      await supabase.from('audit_logs').insert({ deal_id: deal.id, action: 'DISPUTE_OPENED', actor_id: profile.id, details: { reason: disputeReason } });
      toast.success('Dispute opened. Admin will review.');
      setShowDisputeForm(false);
      fetchDeal();
    } catch (err) { console.error(err); toast.error('Failed to open dispute.'); }
    finally { setActionLoading(false); }
  }

  async function handleCancelDeal() {
    if (!window.confirm('Cancel this deal? This cannot be undone.')) return;
    setActionLoading(true);
    try {
      const { error } = await supabase.from('deals').update({ status: DEAL_STATUS.CANCELLED }).eq('id', deal.id);
      if (error) throw error;
      await supabase.from('audit_logs').insert({ deal_id: deal.id, action: 'DEAL_CANCELLED', actor_id: profile.id, details: {} });
      toast.success('Deal cancelled.');
      fetchDeal();
    } catch (err) { console.error(err); toast.error('Failed to cancel deal.'); }
    finally { setActionLoading(false); }
  }

  if (loading) return <div className="loading-screen"><div className="spinner"></div></div>;
  if (!deal) return null;

  const isBuyer = profile?.id === deal.buyer_id;
  const isSeller = profile?.id === deal.seller_id;
  const isCreator = deal.creator_role === 'BUYER' ? isBuyer : isSeller;
  const counterpartyJoined = deal.creator_role === 'BUYER' ? !!deal.seller_id : !!deal.buyer_id;
  const canShare = isCreator && deal.status === DEAL_STATUS.AWAITING_COUNTERPARTY;
  const joinRole = deal.creator_role === 'BUYER' ? 'Seller' : 'Buyer';

  return (
    <div className="page-wrapper deal-details-page">
      <div className="container-md">

        <div className="deal-detail-header-wrap glass-card">
          <div className="deal-detail-header">
            <div className="deal-header-info">
              <h1>{deal.title}</h1>
              <div className="deal-header-meta">
                <StatusBadge status={deal.status} role={isBuyer ? 'buyer' : isSeller ? 'seller' : undefined} />
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
                  <span className="party-name">
                    {deal.buyer_profile?.full_name || (
                      <span className="text-muted">
                        {deal.creator_role === 'BUYER' ? 'You (Creator)' : `Awaiting ${joinRole.toLowerCase()}...`}
                      </span>
                    )}
                  </span>
                </div>
                <div className="party-card">
                  <span className="party-role">Seller</span>
                  <span className="party-name">
                    {deal.seller_profile?.full_name || (
                      <span className="text-muted">
                        {deal.creator_role === 'SELLER' ? 'You (Creator)' : 'Awaiting seller...'}
                      </span>
                    )}
                  </span>
                </div>
              </div>
            </div>

            {canShare && (
              <div className="glass-card">
                <h3 className="detail-section-title">Share Deal</h3>
                <p className="share-hint">Share this link with a {joinRole.toLowerCase()} to let them join the escrow.</p>
                <div className="share-link-row">
                  <input className="form-input" value={shareUrl} readOnly onClick={e => e.target.select()} />
                  <button className="btn btn-primary btn-sm" onClick={copyShareLink}>Copy</button>
                </div>
                <div className="share-buttons">
                  <a className="btn btn-sm btn-share" href={`https://wa.me/?text=${encodeURIComponent(shareUrl)}`} target="_blank" rel="noopener noreferrer">WhatsApp</a>
                  <a className="btn btn-sm btn-share" href={`https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(shareUrl)}`} target="_blank" rel="noopener noreferrer">Facebook</a>
                  <button className="btn btn-sm btn-share" onClick={() => document.getElementById('qr-section').classList.toggle('visible')}>QR Code</button>
                </div>
                <div id="qr-section" className="qr-section">
                  <img src={`https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(shareUrl)}`} alt="QR Code" />
                </div>
              </div>
            )}

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

              {deal.status === DEAL_STATUS.AWAITING_COUNTERPARTY && isCreator && (
                <div className="action-wrapper">
                  <div className="status-notice notice-warning" style={{marginBottom: '12px'}}>
                    <div className="notice-icon">🔗</div>
                    <div className="notice-content">
                      <h4>Awaiting {joinRole}</h4>
                      <p>Share the deal link with a {joinRole.toLowerCase()} to begin the transaction.</p>
                    </div>
                  </div>
                  <button className="btn btn-outline btn-full action-btn" onClick={handleCancelDeal} disabled={actionLoading}>
                    Cancel Deal
                  </button>
                </div>
              )}

              {deal.status === DEAL_STATUS.AWAITING_PAYMENT && isBuyer && !deal.payment_reference && (
                <div className="action-wrapper">
                  <p className="action-hint">Fund the escrow to secure this transaction.</p>
                  <button className="btn btn-primary btn-full btn-lg action-btn" onClick={handlePayment} disabled={actionLoading}>
                    {actionLoading ? <><span className="spinner spinner-sm"></span> Initializing...</> : <><span className="btn-icon">💳</span> Pay with Moolre</>}
                  </button>
                  <button className="btn btn-outline btn-full action-btn" onClick={handleCancelDeal} disabled={actionLoading}>
                    Cancel Deal
                  </button>
                </div>
              )}

              {deal.status === DEAL_STATUS.AWAITING_PAYMENT && isBuyer && deal.payment_reference && (
                <div className="action-wrapper">
                  <div className="status-notice notice-warning" style={{marginBottom: '12px'}}>
                    <div className="notice-icon">⏳</div>
                    <div className="notice-content">
                      <h4>Payment Processing</h4>
                      <p>Your payment is still being processed. Please wait a moment and click the button below to check the status again.</p>
                    </div>
                  </div>
                  <button className="btn btn-primary btn-full action-btn" onClick={handleVerifyPayment} disabled={actionLoading}>
                    {actionLoading ? <><span className="spinner spinner-sm"></span> Checking...</> : 'Check Payment Status'}
                  </button>
                  <button className="btn btn-outline btn-full action-btn" onClick={handleCancelDeal} disabled={actionLoading}>
                    Cancel Deal
                  </button>
                </div>
              )}

              {deal.status === DEAL_STATUS.AWAITING_PAYMENT && isSeller && (
                <div className="action-wrapper">
                  <div className="status-notice notice-warning" style={{marginBottom: '12px'}}>
                    <div className="notice-icon">⏳</div>
                    <div className="notice-content">
                      <h4>Awaiting Payment</h4>
                      <p>Waiting for the buyer to fund the escrow account.</p>
                    </div>
                  </div>
                  <button className="btn btn-outline btn-full action-btn" onClick={handleCancelDeal} disabled={actionLoading}>
                    Cancel Deal
                  </button>
                </div>
              )}

              {deal.status === DEAL_STATUS.IN_ESCROW && isBuyer && !deliveryConfirmed && (
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

              {deal.status === DEAL_STATUS.IN_ESCROW && isBuyer && deliveryConfirmed && (
                <div className="status-notice notice-info">
                  <div className="notice-icon">⏳</div>
                  <div className="notice-content">
                    <h4>Delivery Confirmed</h4>
                    <p>Payout is being sent to the seller.</p>
                  </div>
                </div>
              )}

              {deal.status === DEAL_STATUS.IN_ESCROW && isSeller && !deliveryConfirmed && (
                <div className="status-notice notice-warning">
                  <div className="notice-icon">⏳</div>
                  <div className="notice-content">
                    <h4>Escrow Funded</h4>
                    <p>Funds are secured. Fulfill the contract and wait for the buyer to confirm delivery.</p>
                  </div>
                </div>
              )}

              {deal.status === DEAL_STATUS.IN_ESCROW && isSeller && deliveryConfirmed && (
                <div className="status-notice notice-success">
                  <div className="notice-icon">🎉</div>
                  <div className="notice-content">
                    <h4>Delivery Confirmed</h4>
                    <p>The buyer has confirmed delivery. Your payout is being sent to your mobile money.</p>
                  </div>
                </div>
              )}

              {deal.status === DEAL_STATUS.DELIVERED && isBuyer && (
                <div className="status-notice notice-info">
                  <div className="notice-icon">📦</div>
                  <div className="notice-content">
                    <h4>Delivery Confirmed</h4>
                    <p>You confirmed delivery. The seller will receive payment shortly.</p>
                  </div>
                </div>
              )}

              {deal.status === DEAL_STATUS.DELIVERED && isSeller && (
                <div className="status-notice notice-success">
                  <div className="notice-icon">🎉</div>
                  <div className="notice-content">
                    <h4>Delivery Confirmed</h4>
                    <p>The buyer confirmed delivery. Your payout is on its way to your mobile money.</p>
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

              {deal.status === DEAL_STATUS.DISPUTED && (
                <div className="status-notice notice-danger">
                  <div className="notice-icon">⚠️</div>
                  <div className="notice-content">
                    <h4>Dispute Active</h4>
                    <p>This transaction is currently under administrative review.</p>
                  </div>
                </div>
              )}

              {deal.status === DEAL_STATUS.CANCELLED && (
                <div className="status-notice notice-danger">
                  <div className="notice-icon">✕</div>
                  <div className="notice-content">
                    <h4>Deal Cancelled</h4>
                    <p>This transaction has been cancelled. No funds were exchanged.</p>
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
