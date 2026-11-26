import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { Shield, ShieldCheck, ShieldAlert, ShieldX, Clock, AlertTriangle, Lock } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { formatGHS } from '../utils/fees';
import { LINK_STATUS } from '../utils/constants';
import './LinkGuard.css';

const VERIFY_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/verify-link`;
const OFFICIAL_APP_URL = (import.meta.env.VITE_APP_URL || 'https://dealguider.netlify.app').replace(/\/$/, '');

// UUID format validation (matches server-side)
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Map backend reasons to frontend LINK_STATUS
function reasonToStatus(reason) {
  const map = {
    valid: LINK_STATUS.VERIFIED,
    invalid_token: LINK_STATUS.INVALID_TOKEN,
    not_found: LINK_STATUS.NOT_FOUND,
    expired: LINK_STATUS.EXPIRED,
    revoked: LINK_STATUS.REVOKED,
    closed: LINK_STATUS.CLOSED,
    suspended: LINK_STATUS.SUSPENDED,
    invalid_domain: LINK_STATUS.INVALID_DOMAIN,
    rate_limited: LINK_STATUS.RATE_LIMITED,
    error: LINK_STATUS.ERROR,
  };
  return map[reason] || LINK_STATUS.ERROR;
}

export default function LinkGuard() {
  const { shareToken } = useParams();
  const navigate = useNavigate();
  const [status, setStatus] = useState(LINK_STATUS.VERIFYING);
  const [result, setResult] = useState(null);
  const [errorMessage, setErrorMessage] = useState('');

  const verify = useCallback(async () => {
    // Client-side UUID format check (fast fail before network request)
    if (!shareToken || !UUID_RE.test(shareToken)) {
      setStatus(LINK_STATUS.INVALID_TOKEN);
      setErrorMessage(
        "Unverified Link! We couldn't authenticate this transaction link. For your safety, do not enter personal information or make any payment through this link."
      );
      return;
    }

    setStatus(LINK_STATUS.VERIFYING);

    try {
      const headers = { 'Content-Type': 'application/json' };
      if (import.meta.env.VITE_SUPABASE_ANON_KEY) {
        headers.apikey = import.meta.env.VITE_SUPABASE_ANON_KEY;
      }
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.access_token) {
        headers.Authorization = `Bearer ${session.access_token}`;
      }

      const res = await fetch(VERIFY_URL, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          share_token: shareToken,
          origin: window.location.origin,
        }),
      });

      if (res.status === 429) {
        setStatus(LINK_STATUS.RATE_LIMITED);
        setErrorMessage('Too many verification attempts. Please wait a moment and try again.');
        return;
      }

      const data = await res.json();
      setResult(data);

      if (data.verified) {
        setStatus(LINK_STATUS.VERIFIED);
      } else {
        setStatus(reasonToStatus(data.reason));
        setErrorMessage(data.message || 'This link could not be verified.');
      }
    } catch (err) {
      console.error('[LinkGuard] Verification error:', err);
      setStatus(LINK_STATUS.ERROR);
      setErrorMessage('Unable to verify this link. Please check your connection and try again.');
    }
  }, [shareToken]);

  useEffect(() => {
    const timer = setTimeout(verify, 600);
    return () => clearTimeout(timer);
  }, [verify]);

  function handleProceed() {
    navigate(`/deal/${shareToken}/view`, {
      state: { linkguard_verified: true, verification: result },
      replace: true,
    });
  }

  return (
    <div className="page-wrapper linkguard-page">
      <div className="linkguard-container">
        <div className="linkguard-card glass-card">

          <div className="linkguard-brand" aria-label="DealGuider LinkGuard">
            <div className="linkguard-brand-logo">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path d="M12 2L3 7v10l9 5 9-5V7l-9-5z" fill="url(#lg-brand-grad)" opacity="0.9" />
                <path d="M12 2L3 7l9 5 9-5-9-5z" fill="url(#lg-brand-grad)" opacity="0.6" />
                <defs>
                  <linearGradient id="lg-brand-grad" x1="3" y1="2" x2="21" y2="22">
                    <stop stopColor="#00d4aa" />
                    <stop offset="1" stopColor="#00b4d8" />
                  </linearGradient>
                </defs>
              </svg>
            </div>
            <span className="linkguard-brand-text">DealGuider <strong>LinkGuard</strong></span>
          </div>

          {/* VERIFYING */}
          {status === LINK_STATUS.VERIFYING && (
            <>
              <div className="linkguard-shield linkguard-shield-verifying" role="status" aria-live="polite">
                <Shield size={36} />
              </div>
              <div className="linkguard-status-label linkguard-label-verifying">
                Verifying
              </div>
              <h2 className="linkguard-title">Securing Your Transaction</h2>
              <p className="linkguard-message">
                Securing your transaction. Please wait while we verify this link.
              </p>
              <div className="linkguard-dots" aria-hidden="true">
                <div className="linkguard-dot" />
                <div className="linkguard-dot" />
                <div className="linkguard-dot" />
              </div>
            </>
          )}

          {/* VERIFIED */}
          {status === LINK_STATUS.VERIFIED && result && (
            <>
              <div className="linkguard-shield linkguard-shield-verified">
                <ShieldCheck size={36} />
              </div>
              <div className="linkguard-status-label linkguard-label-verified">
                Verified
              </div>
              <h2 className="linkguard-title">Verified DealGuider Transaction</h2>
              <p className="linkguard-message">
                Verified DealGuider Transaction. This link has been authenticated by DealGuider.
              </p>

              <div className="linkguard-preview">
                <div className="linkguard-preview-title">{result.deal_title}</div>
                <div className="linkguard-preview-amount">{formatGHS(result.deal_amount)}</div>
                <div className="linkguard-preview-status">
                  Status: {result.deal_status?.replace(/_/g, ' ')}
                </div>
              </div>

              <div className="linkguard-actions">
                <button className="btn btn-primary btn-full btn-lg" onClick={handleProceed}>
                  Proceed to Transaction
                </button>
              </div>
            </>
          )}

          {/* INVALID TOKEN / NOT FOUND */}
          {(status === LINK_STATUS.INVALID_TOKEN || status === LINK_STATUS.NOT_FOUND) && (
            <>
              <div className="linkguard-shield linkguard-shield-warning">
                <ShieldAlert size={36} />
              </div>
              <div className="linkguard-status-label linkguard-label-warning">
                Unverified Link
              </div>
              <h2 className="linkguard-title">Unverified Link!</h2>
              <div className="linkguard-warning-box">
                <strong>Security Warning:</strong> We couldn&apos;t authenticate this transaction link.
                For your safety, do not enter personal information or make any payment through this link.
              </div>
              <p className="linkguard-message">{errorMessage}</p>
              <div className="linkguard-actions">
                <Link to="/" className="btn btn-primary btn-full">Visit DealGuider Directly</Link>
              </div>
            </>
          )}

          {/* INVALID DOMAIN (phishing) */}
          {status === LINK_STATUS.INVALID_DOMAIN && (
            <>
              <div className="linkguard-shield linkguard-shield-warning">
                <ShieldAlert size={36} />
              </div>
              <div className="linkguard-status-label linkguard-label-warning">
                Phishing Alert
              </div>
              <h2 className="linkguard-title">Unauthorized Domain Detected</h2>
              <div className="linkguard-warning-box">
                <strong>Phishing Warning:</strong> This page is not being served from an official
                DealGuider domain. It may be a fraudulent copy designed to steal your information.
                <strong> Do not enter any personal details or payment information.</strong>
              </div>
              <p className="linkguard-message">{errorMessage}</p>
              <div className="linkguard-actions">
                <a href={OFFICIAL_APP_URL} className="btn btn-primary btn-full" rel="noopener noreferrer">
                  Go to Official DealGuider
                </a>
              </div>
            </>
          )}

          {/* EXPIRED */}
          {status === LINK_STATUS.EXPIRED && (
            <>
              <div className="linkguard-shield linkguard-shield-expired">
                <Clock size={36} />
              </div>
              <div className="linkguard-status-label linkguard-label-expired">
                Link Expired
              </div>
              <h2 className="linkguard-title">This Link Has Expired</h2>
              <p className="linkguard-message">
                This transaction link has expired or is no longer active. Please contact the sender for a valid link.
              </p>
              <div className="linkguard-actions">
                <Link to="/" className="btn btn-primary btn-full">Visit DealGuider Directly</Link>
              </div>
            </>
          )}

          {/* REVOKED */}
          {status === LINK_STATUS.REVOKED && (
            <>
              <div className="linkguard-shield linkguard-shield-warning">
                <ShieldX size={36} />
              </div>
              <div className="linkguard-status-label linkguard-label-warning">
                Link Revoked
              </div>
              <h2 className="linkguard-title">This Link Is No Longer Valid</h2>
              <p className="linkguard-message">
                This transaction link has expired or is no longer active. Please contact the sender for a valid link.
              </p>
              <div className="linkguard-actions">
                <Link to="/" className="btn btn-primary btn-full">Visit DealGuider Directly</Link>
              </div>
            </>
          )}

          {/* CLOSED (completed/cancelled/refunded) */}
          {status === LINK_STATUS.CLOSED && (
            <>
              <div className="linkguard-shield linkguard-shield-info">
                <AlertTriangle size={36} />
              </div>
              <div className="linkguard-status-label linkguard-label-info">
                Transaction Closed
              </div>
              <h2 className="linkguard-title">This Transaction Is No Longer Active</h2>
              <p className="linkguard-message">
                This transaction link has expired or is no longer active. Please contact the sender for a valid link.
              </p>
              <div className="linkguard-actions">
                <Link to="/dashboard" className="btn btn-primary btn-full">Go to Dashboard</Link>
                <Link to="/" className="btn btn-outline btn-full">Visit DealGuider Directly</Link>
              </div>
            </>
          )}

          {/* SUSPENDED (disputed) */}
          {status === LINK_STATUS.SUSPENDED && (
            <>
              <div className="linkguard-shield linkguard-shield-expired">
                <ShieldAlert size={36} />
              </div>
              <div className="linkguard-status-label linkguard-label-expired">
                Under Review
              </div>
              <h2 className="linkguard-title">Transaction Under Review</h2>
              <p className="linkguard-message">
                This transaction is currently under administrative review. Access through this link is temporarily suspended.
              </p>
              <div className="linkguard-actions">
                <Link to="/dashboard" className="btn btn-primary btn-full">Go to Dashboard</Link>
              </div>
            </>
          )}

          {/* RATE LIMITED */}
          {status === LINK_STATUS.RATE_LIMITED && (
            <>
              <div className="linkguard-shield linkguard-shield-expired">
                <Clock size={36} />
              </div>
              <div className="linkguard-status-label linkguard-label-expired">
                Too Many Attempts
              </div>
              <h2 className="linkguard-title">Please Wait</h2>
              <p className="linkguard-message">
                {errorMessage}
              </p>
              <div className="linkguard-actions">
                <button className="btn btn-outline btn-full" onClick={() => { setStatus(LINK_STATUS.VERIFYING); verify(); }}>
                  Retry Verification
                </button>
              </div>
            </>
          )}

          {/* ERROR */}
          {status === LINK_STATUS.ERROR && (
            <>
              <div className="linkguard-shield linkguard-shield-info">
                <AlertTriangle size={36} />
              </div>
              <div className="linkguard-status-label linkguard-label-info">
                Verification Error
              </div>
              <h2 className="linkguard-title">Verification Unavailable</h2>
              <p className="linkguard-message">
                {errorMessage}
              </p>
              <div className="linkguard-actions">
                <button className="btn btn-primary btn-full" onClick={() => { setStatus(LINK_STATUS.VERIFYING); verify(); }}>
                  Retry Verification
                </button>
                <Link to="/" className="btn btn-outline btn-full">Visit DealGuider Directly</Link>
              </div>
            </>
          )}

        </div>

        <div className="linkguard-footer">
          <span className="linkguard-footer-icon"><Lock size={14} /></span>
          <span>Protected by DealGuider LinkGuard</span>
        </div>
      </div>
    </div>
  );
}
