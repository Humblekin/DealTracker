import { useState } from 'react';
import { Link, useNavigate, useSearchParams, Navigate } from 'react-router-dom';
import { Mail, Lock, Eye, EyeOff } from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import { supabase } from '../lib/supabase';
import toast from 'react-hot-toast';
import './Auth.css';

export default function Login() {
  const { signIn, user, isAdmin } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [formData, setFormData] = useState({
    email: '',
    password: '',
  });

  if (user) {
    const redirect = searchParams.get('redirect');
    return <Navigate to={redirect || (isAdmin ? '/admin' : '/dashboard')} replace />;
  }

  const handleChange = (e) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      const result = await signIn({ email: formData.email, password: formData.password });

      // Honor the share-link redirect first — role resolution is only needed otherwise.
      const redirect = searchParams.get('redirect');
      if (redirect) {
        navigate(redirect);
        return;
      }

      // Resolve the signed-in user through several fallbacks so a transient
      // session race never dead-ends the user with an error. Use the session
      // returned by signIn instead of supabase.auth.getUser() — an extra /user
      // round-trip right after login can trigger a redundant token refresh that
      // races other open tabs into GoTrue's rate limit and rotates the token.
      const authUser = result?.session?.user || result?.user || (await supabase.auth.getSession()).data?.session?.user;

      let profile;
      if (authUser) {
        const { data } = await supabase.from('profiles').select('role').eq('id', authUser.id).limit(1).maybeSingle();
        profile = data;
      }

      if (profile) {
        if (profile.role === 'admin') {
          import('./AdminDashboard');
          navigate('/admin');
        } else {
          import('./Transactions');
          import('./CreateDeal');
          navigate('/dashboard');
        }
        return;
      }

      // Profile not visible yet — never force a full reload here. AuthContext's
      // fetchProfile will create/fix the profile row, and ProtectedRoute handles
      // redirects, so navigating to /dashboard is safe and loop-free.
      navigate('/dashboard');
    } catch (err) {
      toast.error(err.message || 'Invalid credentials');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-page">
      <div className="auth-bg-effects">
        <div className="auth-grid"></div>
        <div className="auth-glow-ring"></div>
        <div className="auth-orb orb-primary"></div>
        <div className="auth-orb orb-secondary"></div>
        <div className="auth-orb orb-tertiary"></div>
      </div>
      <div className="auth-container">
        <div className="auth-card glass-card">
          <div className="auth-header">
            <Link to="/" className="auth-brand">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none">
                <path d="M12 2L3 7v10l9 5 9-5V7l-9-5z" fill="url(#auth-grad)" opacity="0.9"/>
                <path d="M12 2L3 7l9 5 9-5-9-5z" fill="url(#auth-grad)" opacity="0.6"/>
                <defs>
                  <linearGradient id="auth-grad" x1="3" y1="2" x2="21" y2="22">
                    <stop stopColor="#00d4aa"/>
                    <stop offset="1" stopColor="#00b4d8"/>
                  </linearGradient>
                </defs>
              </svg>
              <span>Deal<span className="brand-accent">Guider</span></span>
            </Link>
            <h1>Welcome Back</h1>
            <p>Access your secure dashboard</p>
          </div>

          <form onSubmit={handleSubmit} className="auth-form">
            <div className="form-group">
              <label className="form-label" htmlFor="login-email">Email Address</label>
              <div className="auth-input-wrap">
                <Mail size={18} aria-hidden="true" />
                <input
                  id="login-email"
                  type="email"
                  name="email"
                  className="form-input"
                  placeholder="name@company.com"
                  autoComplete="email"
                  value={formData.email}
                  onChange={handleChange}
                  required
                />
              </div>
            </div>

            <div className="form-group">
              <label className="form-label" htmlFor="login-password">Password</label>
              <div className="auth-input-wrap">
                <Lock size={18} aria-hidden="true" />
                <input
                  id="login-password"
                  type={showPassword ? 'text' : 'password'}
                  name="password"
                  className="form-input"
                  placeholder="••••••••"
                  autoComplete="current-password"
                  value={formData.password}
                  onChange={handleChange}
                  required
                />
                <button
                  type="button"
                  className="auth-eye"
                  onClick={() => setShowPassword((s) => !s)}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                >
                  {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
            </div>

            <button type="submit" className="btn btn-primary btn-auth btn-full btn-lg" disabled={loading}>
              {loading ? (
                <>
                  <span className="spinner spinner-sm"></span>
                  Authenticating...
                </>
              ) : (
                'Sign In'
              )}
            </button>
          </form>

          <div className="auth-footer">
            <p>Need an account? <Link to="/register">Open an account</Link></p>
          </div>
        </div>
      </div>
    </div>
  );
}
