import { useState, useEffect } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';
import StatusBadge from '../components/StatusBadge';
import { formatGHS } from '../utils/fees';
import { DEAL_STATUS } from '../utils/constants';
import toast from 'react-hot-toast';
import './DealDetails.css';
import './SharedDeal.css';

const EDGE_FUNCTION_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/join-deal`;

export default function SharedDeal() {
  const { shareToken } = useParams();
  const { profile } = useAuth();
  const navigate = useNavigate();
  const [deal, setDeal] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [joining, setJoining] = useState(false);

  useEffect(() => {
    if (!shareToken) return;
    supabase.from('deals')
      .select('*, buyer_profile:profiles!buyer_id(full_name), seller_profile:profiles!seller_id(full_name)')
      .eq('share_token', shareToken)
      .single()
      .then(({ data, error }) => {
        if (error || !data) setError('Deal not found');
        else setDeal(data);
      })
      .finally(() => setLoading(false));
  }, [shareToken]);

  async function handleJoin() {
    setJoining(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/join-deal`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${session?.access_token}`,
          },
          body: JSON.stringify({ share_token: shareToken }),
        }
      );
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || 'Failed to join deal');
      toast.success(`You joined as ${deal.creator_role === 'BUYER' ? 'seller' : 'buyer'}!`);
      navigate(`/deals/${body.deal_id}`);
    } catch (err) {
      if (err instanceof TypeError && err.message === 'Failed to fetch') {
        toast.error('Unable to reach the server. The join-deal edge function may not be deployed.');
      } else {
        toast.error(err.message);
      }
    } finally {
      setJoining(false);
    }
  }

  if (loading) return <div className="loading-screen"><div className="spinner"></div></div>;

  if (error) return (
    <div className="page-wrapper">
      <div className="container-md" style={{ textAlign: 'center', paddingTop: '80px' }}>
        <h2>Deal Not Found</h2>
        <p>This link may be invalid or the deal has been removed.</p>
        <Link to="/" className="btn btn-primary mt-4">Go Home</Link>
      </div>
    </div>
  );

  const counterpartyFilled = deal.creator_role === 'BUYER' ? !!deal.seller_id : !!deal.buyer_id;
  const isCreator = deal.creator_role === 'BUYER'
    ? profile?.id === deal.buyer_id
    : profile?.id === deal.seller_id;
  const isCounterparty = deal.creator_role === 'BUYER'
    ? profile?.id === deal.seller_id
    : profile?.id === deal.buyer_id;
  const joinRole = deal.creator_role === 'BUYER' ? 'Seller' : 'Buyer';

  return (
    <div className="page-wrapper shared-deal-page">
      <div className="container-sm">
        <div className="deal-card glass-card">
          <div className="deal-card-header">
            <StatusBadge status={deal.status} />
            <div className="deal-card-amount">
              <span className="amount-label">Amount</span>
              <p className="deal-amount-val">{formatGHS(deal.amount)}</p>
            </div>
          </div>

          <h1 className="deal-title">{deal.title}</h1>

          {deal.description && (
            <p className="deal-description">{deal.description}</p>
          )}

          <div className="deal-parties">
            <div className="party-badge">
              <span className="party-badge-role">Created by</span>
              <span className="party-badge-name">
                {deal.creator_role === 'BUYER'
                  ? (deal.buyer_profile?.full_name || 'The Buyer')
                  : (deal.seller_profile?.full_name || 'The Seller')}
              </span>
              <span className="party-badge-tag">
                as {deal.creator_role === 'BUYER' ? 'Buyer' : 'Seller'}
              </span>
            </div>
            {counterpartyFilled && (
              <div className="party-badge joined">
                <span className="party-badge-role">Joined</span>
                <span className="party-badge-name">
                  {deal.creator_role === 'BUYER'
                    ? deal.seller_profile?.full_name
                    : deal.buyer_profile?.full_name}
                </span>
              </div>
            )}
          </div>

          <div className="deal-card-footer">
            {isCreator && deal.status === DEAL_STATUS.AWAITING_COUNTERPARTY && (
              <p className="waiting-message">
                Waiting for a {joinRole.toLowerCase()} to join...
              </p>
            )}

            {isCounterparty && (
              <div className="joined-message">
                <span className="joined-icon">✓</span>
                You already joined this deal as {deal.creator_role === 'BUYER' ? 'seller' : 'buyer'}
              </div>
            )}

            {!isCreator && !isCounterparty && deal.status === DEAL_STATUS.AWAITING_COUNTERPARTY && !counterpartyFilled && profile && (
              <button className="btn btn-primary btn-full btn-lg" onClick={handleJoin} disabled={joining}>
                {joining ? <><span className="spinner spinner-sm"></span> Joining...</> : `Join as ${joinRole}`}
              </button>
            )}

            {!isCreator && !isCounterparty && deal.status === DEAL_STATUS.AWAITING_COUNTERPARTY && !counterpartyFilled && !profile && (
              <div className="auth-prompt">
                <button className="btn btn-primary btn-full btn-lg" onClick={() => navigate(`/login?redirect=/deal/${shareToken}`)}>
                  Sign In to Join as {joinRole}
                </button>
                <p className="login-hint">
                  No account? <Link to={`/register?redirect=/deal/${shareToken}`}>Create one</Link>
                </p>
              </div>
            )}

            {!isCreator && !isCounterparty && deal.status !== DEAL_STATUS.AWAITING_COUNTERPARTY && (
              <div className="joined-message">
                <span className="joined-icon">✓</span>
                Counterparty Joined
              </div>
            )}

            {isCreator && counterpartyFilled && (
              <Link to={`/deals/${deal.id}`} className="btn btn-primary btn-full">
                View Deal
              </Link>
            )}
          </div>
        </div>

        <div className="secure-badge">
          <span className="secure-icon">🔒</span>
          <span>Protected by DealGuider escrow. Payment is held safely until both parties are satisfied.</span>
        </div>
      </div>
    </div>
  );
}
