import { Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import './Landing.css';

export default function Landing() {
  const { user } = useAuth();

  return (
    <div className="landing">
      {/* Hero Section */}
      <section className="hero">
        <div className="hero-bg-effects">
          <div className="hero-grid"></div>
          <div className="hero-orb orb-primary"></div>
          <div className="hero-orb orb-secondary"></div>
        </div>
        <div className="container hero-content">
          <div className="hero-badge">
            <span className="badge-dot"></span>
            Trusted by Businesses in Ghana 🇬🇭
          </div>
          <h1 className="hero-title">
            Secure Escrow for<br />
            <span className="gradient-text">Modern Commerce</span>
          </h1>
          <p className="hero-subtitle">
            Transact with absolute confidence. Our institutional-grade escrow platform 
            protects your funds until both parties are fully satisfied.
          </p>
          <div className="hero-actions">
            {user ? (
              <Link to="/dashboard" className="btn btn-primary btn-lg">
                Go to Dashboard
                <span className="btn-arrow">→</span>
              </Link>
            ) : (
              <>
                <Link to="/register" className="btn btn-primary btn-lg">
                  Open Free Account
                  <span className="btn-arrow">→</span>
                </Link>
                <Link to="/login" className="btn btn-secondary btn-lg">
                  Sign In
                </Link>
              </>
            )}
          </div>
          <div className="hero-trust">
            <p>Powered by institutional infrastructure</p>
            <div className="trust-logos">
              <span className="trust-logo">MOOLRE</span>
              <span className="trust-logo">MTN MOMO</span>
              <span className="trust-logo">TELECEL</span>
              <span className="trust-logo">AT</span>
            </div>
          </div>
        </div>
      </section>

      {/* How It Works */}
      <section className="how-it-works">
        <div className="container">
          <div className="section-header">
            <h2 className="section-title">Institutional-Grade Security</h2>
            <p className="section-subtitle">A streamlined, transparent process designed to eliminate transaction risk.</p>
          </div>
          
          <div className="steps-grid">
            <div className="step-card">
              <div className="step-icon-wrap">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--accent-primary)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><polyline points="10 9 9 9 8 9"></polyline></svg>
              </div>
              <div className="step-number">01</div>
              <h3>Initiate Agreement</h3>
              <p>Create a detailed transaction contract defining terms, conditions, and amounts. Full transparency from day one.</p>
            </div>
            
            <div className="step-connector">
              <div className="connector-line"></div>
            </div>
            
            <div className="step-card">
              <div className="step-icon-wrap">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--accent-primary)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>
              </div>
              <div className="step-number">02</div>
              <h3>Secure Funding</h3>
              <p>Funds are deposited into our audited escrow vault. The seller is instantly notified that capital is secured.</p>
            </div>
            
            <div className="step-connector">
              <div className="connector-line"></div>
            </div>
            
            <div className="step-card">
              <div className="step-icon-wrap">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--accent-primary)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>
              </div>
              <div className="step-number">03</div>
              <h3>Verify & Disburse</h3>
              <p>Upon buyer confirmation of satisfactory delivery, funds are instantly disbursed to the seller's account.</p>
            </div>
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="features-section">
        <div className="container">
          <div className="section-header">
            <h2 className="section-title">Built for Reliability</h2>
            <p className="section-subtitle">Advanced infrastructure ensuring every transaction executes flawlessly.</p>
          </div>
          
          <div className="features-grid">
            <div className="feature-card glass-card">
              <div className="feature-icon">🛡️</div>
              <h3>Automated Escrow Vault</h3>
              <p>Zero manual intervention. Funds are programmatically secured and released only upon verified milestone completion.</p>
            </div>
            <div className="feature-card glass-card">
              <div className="feature-icon">⚡</div>
              <h3>Real-time Settlement</h3>
              <p>Instant disbursements via API integration with major telecommunications and banking networks in Ghana.</p>
            </div>
            <div className="feature-card glass-card">
              <div className="feature-icon">⚖️</div>
              <h3>Arbitration Protocol</h3>
              <p>Structured dispute resolution framework managed by impartial administrators within guaranteed SLAs.</p>
            </div>
            <div className="feature-card glass-card">
              <div className="feature-icon">📊</div>
              <h3>Transparent Economics</h3>
              <p>Clear, deterministic fee structures. No hidden charges. Complete visibility into capital flows.</p>
            </div>
            <div className="feature-card glass-card">
              <div className="feature-icon">📜</div>
              <h3>Immutable Audit Trail</h3>
              <p>Comprehensive logging of all state changes, providing undeniable proof of actions for both parties.</p>
            </div>
            <div className="feature-card glass-card">
              <div className="feature-icon">🔐</div>
              <h3>Enterprise Security</h3>
              <p>Bank-level encryption, rigorous rate limiting, and robust authentication safeguarding your account.</p>
            </div>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="cta-section">
        <div className="container">
          <div className="cta-card glass-card">
            <div className="cta-content">
              <h2>Ready to secure your transactions?</h2>
              <p>Join thousands of professionals trading safely on our platform.</p>
              {!user && (
                <Link to="/register" className="btn btn-primary btn-lg">
                  Create Account
                  <span className="btn-arrow">→</span>
                </Link>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="landing-footer">
        <div className="container">
          <div className="footer-content">
            <div className="footer-brand">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
                <path d="M12 2L3 7v10l9 5 9-5V7l-9-5z" fill="url(#footer-grad)" opacity="0.9"/>
                <path d="M12 2L3 7l9 5 9-5-9-5z" fill="url(#footer-grad)" opacity="0.6"/>
                <defs>
                  <linearGradient id="footer-grad" x1="3" y1="2" x2="21" y2="22">
                    <stop stopColor="#00d4aa"/>
                    <stop offset="1" stopColor="#00b4d8"/>
                  </linearGradient>
                </defs>
              </svg>
              <span>Secure<span className="brand-accent">Trade</span></span>
            </div>
            <p className="footer-copy">© {new Date().getFullYear()} SecureTrade Technologies. All rights reserved.</p>
          </div>
        </div>
      </footer>
    </div>
  );
}
