import { useState, useEffect, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';
import FeeBreakdown from '../components/FeeBreakdown';
import { calculateFees, formatGHS } from '../utils/fees';
import toast from 'react-hot-toast';
import './CreateDeal.css';

export default function CreateDeal() {
  const { profile } = useAuth();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [sellers, setSellers] = useState([]);
  const [formData, setFormData] = useState({ title: '', description: '', amount: '', seller_id: '' });
  const [searchTerm, setSearchTerm] = useState('');
  const [showResults, setShowResults] = useState(false);
  const searchRef = useRef(null);

  useEffect(() => {
    supabase.from('profiles').select('id, full_name, email').neq('role', 'admin')
      .then(({ data }) => setSellers((data || []).filter(s => s.id !== profile?.id)));
      
    const handleClick = (e) => {
      if (searchRef.current && !searchRef.current.contains(e.target)) {
        setShowResults(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [profile]);

  const filteredSellers = useMemo(() => {
    if (!searchTerm.trim()) return [];
    const term = searchTerm.toLowerCase();
    return sellers.filter(s =>
      s.full_name.toLowerCase().includes(term) ||
      s.email.toLowerCase().includes(term)
    );
  }, [searchTerm, sellers]);

  const selectedSeller = sellers.find(s => s.id === formData.seller_id);
  const fees = useMemo(() => calculateFees(formData.amount), [formData.amount]);
  
  const handleChange = (e) => setFormData({ ...formData, [e.target.name]: e.target.value });

  function selectSeller(seller) {
    setFormData({ ...formData, seller_id: seller.id });
    setSearchTerm('');
    setShowResults(false);
  }

  function clearSelection() {
    setFormData({ ...formData, seller_id: '' });
    setSearchTerm('');
  }

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!formData.seller_id) { toast.error('Please select a seller'); return; }
    if (parseFloat(formData.amount) <= 0) { toast.error('Amount must be greater than 0'); return; }
    setLoading(true);
    try {
      const { data, error } = await supabase.from('deals').insert({
        title: formData.title,
        description: formData.description,
        amount: parseFloat(formData.amount),
        buyer_id: profile.id,
        seller_id: formData.seller_id,
        status: 'PENDING_PAYMENT',
        fee_breakdown: fees,
      }).select().single();
      
      if (error) throw error;
      
      await supabase.from('audit_logs').insert({ deal_id: data.id, action: 'DEAL_CREATED', actor_id: profile.id, details: { amount: formData.amount } });
      toast.success('Deal contract created successfully');
      navigate(`/deals/${data.id}`);
    } catch (err) { toast.error(err.message || 'Failed to create deal'); }
    finally { setLoading(false); }
  };

  return (
    <div className="page-wrapper create-deal-page">
      <div className="container-md">
        <div className="page-header text-center">
          <h1>Initiate Transaction</h1>
          <p>Create a secure escrow contract with a seller</p>
        </div>
        
        <div className="create-deal-layout">
          <div className="glass-card">
            <form onSubmit={handleSubmit} className="deal-form">
              <div className="form-section">
                <h3 className="section-title">Contract Details</h3>
                <div className="form-group">
                  <label className="form-label">Transaction Title</label>
                  <input name="title" className="form-input form-input-lg" placeholder="e.g. Graphic Design Services" value={formData.title} onChange={handleChange} required />
                </div>
                <div className="form-group">
                  <label className="form-label">Terms & Description</label>
                  <textarea name="description" className="form-textarea" placeholder="Clearly outline deliverables, timelines, and conditions for this transaction..." value={formData.description} onChange={handleChange} />
                </div>
              </div>

              <div className="form-section">
                <h3 className="section-title">Counterparty</h3>
                <div className="form-group">
                  <label className="form-label">Select Seller</label>
                  {selectedSeller ? (
                    <div className="seller-chip active">
                      <div className="seller-avatar">{selectedSeller.full_name.charAt(0).toUpperCase()}</div>
                      <div className="seller-info">
                        <span className="seller-name">{selectedSeller.full_name}</span>
                        <span className="seller-email">{selectedSeller.email}</span>
                      </div>
                      <button type="button" className="seller-remove" onClick={clearSelection} aria-label="Remove seller">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                      </button>
                    </div>
                  ) : (
                    <div className="seller-search-wrapper" ref={searchRef}>
                      <div className="search-input-wrap">
                        <svg className="search-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
                        <input
                          type="text"
                          className="form-input search-input"
                          placeholder="Search registered users by name or email..."
                          value={searchTerm}
                          onChange={e => { setSearchTerm(e.target.value); setShowResults(true); }}
                          onFocus={() => setShowResults(true)}
                          autoComplete="off"
                        />
                      </div>
                      
                      {showResults && searchTerm.trim() && (
                        <div className="seller-results-dropdown">
                          {filteredSellers.length === 0 ? (
                            <div className="seller-no-results">
                              <p>No users found matching "{searchTerm}"</p>
                              <span>Ensure they have created a SecureTrade account.</span>
                            </div>
                          ) : (
                            filteredSellers.map(s => (
                              <button type="button" key={s.id} className="seller-result-item" onClick={() => selectSeller(s)}>
                                <div className="seller-avatar">{s.full_name.charAt(0).toUpperCase()}</div>
                                <div className="seller-info">
                                  <span className="seller-name">{s.full_name}</span>
                                  <span className="seller-email">{s.email}</span>
                                </div>
                              </button>
                            ))
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>

              <div className="form-section">
                <h3 className="section-title">Financials</h3>
                <div className="form-group">
                  <label className="form-label">Principal Amount (GHS)</label>
                  <div className="amount-input-wrap">
                    <span className="currency-symbol">GH₵</span>
                    <input name="amount" type="number" step="0.01" min="1" className="form-input amount-input" placeholder="0.00" value={formData.amount} onChange={handleChange} required />
                  </div>
                </div>
                
                {parseFloat(formData.amount) > 0 && (
                  <div className="fee-preview">
                    <h4 className="fee-preview-title">Transaction Economics</h4>
                    <FeeBreakdown fees={fees} expanded />
                  </div>
                )}
              </div>

              <button type="submit" className="btn btn-primary btn-full btn-lg create-btn" disabled={loading || !formData.seller_id}>
                {loading ? <><span className="spinner spinner-sm"></span>Initializing Contract...</> : `Initialize Contract — ${formatGHS(fees.totalPayable || 0)}`}
              </button>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}
