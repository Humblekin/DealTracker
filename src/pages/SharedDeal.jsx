import { useState, useEffect } from 'react';
import { useParams, Link, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { supabase } from '../lib/supabase';
import StatusBadge from '../components/StatusBadge';
import DealGuiderMascot from '../components/DealGuiderMascot';
import { formatGHS } from '../utils/fees';
import { DEAL_STATUS, getCounterpartyRoleLabel } from '../utils/constants';
import { Check, ShieldCheck } from 'lucide-react';
import toast from 'react-hot-toast';
import './DealDetails.css';
import './SharedDeal.css';

const EDGE_FUNCTION_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/join-deal`;

export default function SharedDeal() {
  const { shareToken } = useParams();
  const { profile } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [joining, setJoining] = useState(false);

  // LinkGuard verification guard: require verified payload passed from LinkGuard
  const verifiedPayload = location.state?.linkguard_verified === true
    ? location.state?.verification?.deal || null
    : null;
  const isVerified = Boolean(verifiedPayload);

  useEffect(() => {
    // Redirect any direct or unverified access back through LinkGuard
    if (!isVerified && shareToken) {
      navigate(`/deal/${shareToken}`, { replace: true });
    }
  }, [shareToken, isVerified, navigate]);

  const deal = verifiedPayload
    ? {
      ...verifiedPayload,
      buyer_profile: verifiedPayload.buyer_name ? { full_name: verifiedPayload.buyer_name } : null,
      seller_profile: verifiedPayload.seller_name ? { full_name: verifiedPayload.seller_name } : null,
    }
    : null;

  async function handleJoin() {
    setJoining(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(
        EDGE_FUNCTION_URL,
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
      toast.success(`You joined as ${getCounterpartyRoleLabel(deal.creator_role).toLowerCase()}!`);
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

  if (!isVerified) return null;

  if (!deal) return (
    <div className="page-wrapper">
      <div className="container-md" style={{ textAlign: 'center', paddingTop: '48px' }}>
        <DealGuiderMascot
          variant="invalid-deal"
          size="xl"
          alt="Kofi looking puzzled as the deal link could not be found"
          style={{ margin: '0 auto 16px' }}
        />
        <h2>Deal Not Found</h2>
        <p>This link may be invalid or the deal has been removed.</p>
        <Link to="/" className="btn btn-primary mt-4">Go Home</Link>
      </div>
    </div>
  );

  const counterpartyFilled = Boolean(deal.counterparty_filled);
  const isCreator = Boolean(deal.is_creator);
  const isCounterparty = Boolean(deal.is_counterparty);
  const joinRole = getCounterpartyRoleLabel(deal.creator_role);

  return (
    <div className="page-wrapper shared-deal-page">
      <div className="container-sm">
        <div className="shared-deal-card glass-card">
          <div className="shared-deal-card-header">
            <StatusBadge status={deal.status} />
            <div className="shared-deal-card-amount">
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

          <div className="shared-deal-card-footer">
            {isCreator && deal.status === DEAL_STATUS.AWAITING_COUNTERPARTY && (
              <p className="waiting-message">
                Waiting for a {joinRole.toLowerCase()} to join...
              </p>
            )}

            {isCounterparty && (
              <div className="joined-message">
                <span className="joined-icon"><Check size={16} /></span>
                You already joined this deal as {joinRole.toLowerCase()}
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
                <span className="joined-icon"><Check size={16} /></span>
                Counterparty Joined
              </div>
            )}

            {isCreator && counterpartyFilled && deal.id && (
              <Link to={`/deals/${deal.id}`} className="btn btn-primary btn-full">
                View Deal
              </Link>
            )}
          </div>
        </div>

        <div className="secure-badge">
          <span className="secure-icon"><ShieldCheck size={16} /></span>
          <span>Verified by DealGuider LinkGuard · Escrow-protected transaction</span>
        </div>
      </div>
    </div>
  );
}
