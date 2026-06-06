import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';
import toast from 'react-hot-toast';
import './Auth.css';

export default function Register() {
  const { signUp } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [loading, setLoading] = useState(false);
  const [formData, setFormData] = useState({
    fullName: '', email: '', password: '', confirmPassword: '', role: 'buyer',
  });

  const handleChange = (e) => setFormData({ ...formData, [e.target.name]: e.target.value });

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (formData.password.length < 8) { toast.error('Password must be at least 8 characters'); return; }
    if (!/[A-Z]/.test(formData.password)) { toast.error('Password must contain an uppercase letter'); return; }
    if (!/[0-9]/.test(formData.password)) { toast.error('Password must contain a number'); return; }
    if (formData.password !== formData.confirmPassword) { toast.error('Passwords do not match'); return; }
    setLoading(true);
    try {
      await signUp({ email: formData.email, password: formData.password, fullName: formData.fullName, role: formData.role });
      toast.success('Account created successfully');
      const redirect = searchParams.get('redirect');
      if (redirect) navigate(redirect);
      else navigate('/dashboard');
    } catch (err) { console.error(err); toast.error('Registration failed. Please try again.'); }
    finally { setLoading(false); }
  };

  return (
    <div className="auth-page">
      <div className="auth-bg-effects">
        <div className="auth-grid"></div>
        <div className="auth-orb orb-primary"></div>
      </div>
      <div className="auth-container">
        <div className="auth-card glass-card">
          <div className="auth-header">
            <Link to="/" className="auth-brand">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none">
                <path d="M12 2L3 7v10l9 5 9-5V7l-9-5z" fill="url(#auth-grad-reg)" opacity="0.9"/>
                <path d="M12 2L3 7l9 5 9-5-9-5z" fill="url(#auth-grad-reg)" opacity="0.6"/>
                <defs>
                  <linearGradient id="auth-grad-reg" x1="3" y1="2" x2="21" y2="22">
                    <stop stopColor="#00d4aa"/>
                    <stop offset="1" stopColor="#00b4d8"/>
                  </linearGradient>
                </defs>
              </svg>
              <span>Secure<span className="brand-accent">Trade</span></span>
            </Link>
            <h1>Create Account</h1>
            <p>Join the secure trading infrastructure</p>
          </div>
          
          <form onSubmit={handleSubmit} className="auth-form">
            <div className="form-group">
              <label className="form-label" htmlFor="reg-name">Legal Name</label>
              <input id="reg-name" type="text" name="fullName" className="form-input" placeholder="Kwame Asante" value={formData.fullName} onChange={handleChange} required />
            </div>
            
            <div className="form-group">
              <label className="form-label" htmlFor="reg-email">Email Address</label>
              <input id="reg-email" type="email" name="email" className="form-input" placeholder="name@company.com" value={formData.email} onChange={handleChange} required />
            </div>
            
            <div className="form-group">
              <label className="form-label" htmlFor="reg-password">Password</label>
              <input id="reg-password" type="password" name="password" className="form-input" placeholder="Min 8 chars, uppercase, number" value={formData.password} onChange={handleChange} required minLength={8} />
            </div>
            
            <div className="form-group">
              <label className="form-label" htmlFor="reg-confirm">Confirm Password</label>
              <input id="reg-confirm" type="password" name="confirmPassword" className="form-input" placeholder="••••••••" value={formData.confirmPassword} onChange={handleChange} required />
            </div>
            
            <div className="form-group">
              <label className="form-label">Primary Usage</label>
              <div className="role-selector">
                <label className={`role-option ${formData.role === 'buyer' ? 'active' : ''}`}>
                  <input type="radio" name="role" value="buyer" checked={formData.role === 'buyer'} onChange={handleChange} />
                  <span className="role-option-content">
                    <span className="role-option-icon">🛒</span>
                    <span className="role-option-label">Buyer</span>
                    <span className="role-option-desc">Fund and approve deals</span>
                  </span>
                </label>
                <label className={`role-option ${formData.role === 'seller' ? 'active' : ''}`}>
                  <input type="radio" name="role" value="seller" checked={formData.role === 'seller'} onChange={handleChange} />
                  <span className="role-option-content">
                    <span className="role-option-icon">💼</span>
                    <span className="role-option-label">Seller</span>
                    <span className="role-option-desc">Provide goods/services</span>
                  </span>
                </label>
              </div>
            </div>
            
            <button type="submit" className="btn btn-primary btn-full btn-lg" disabled={loading}>
              {loading ? <><span className="spinner spinner-sm"></span>Processing...</> : 'Open Account'}
            </button>
          </form>
          
          <div className="auth-footer">
            <p>Already have an account? <Link to="/login">Sign in</Link></p>
          </div>
        </div>
      </div>
    </div>
  );
}
