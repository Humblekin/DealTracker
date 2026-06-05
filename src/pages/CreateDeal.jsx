import { useState, useMemo } from 'react';
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
  const [creatorRole, setCreatorRole] = useState(null);
  const [formData, setFormData] = useState({ title: '', description: '', amount: '' });

  const handleChange = (e) => setFormData({ ...formData, [e.target.name]: e.target.value });

  const fees = useMemo(() => calculateFees(formData.amount), [formData.amount]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!creatorRole) { toast.error('Select your role in this transaction'); return; }
    if (!formData.title.trim() || formData.title.length > 200) { toast.error('Title is required (max 200 characters)'); return; }
    if (formData.description && formData.description.length > 5000) { toast.error('Description must be under 5000 characters'); return; }
    if (parseFloat(formData.amount) <= 0 || parseFloat(formData.amount) > 9999999.99) { toast.error('Amount must be between 0.01 and 9,999,999.99'); return; }
    setLoading(true);
    try {
      const shareToken = crypto.randomUUID();
      const isBuyer = creatorRole === 'BUYER';
      const { data, error } = await supabase.from('deals').insert({
        title: formData.title,
        description: formData.description,
        amount: parseFloat(formData.amount),
        creator_role: creatorRole,
        buyer_id: isBuyer ? profile.id : null,
        seller_id: isBuyer ? null : profile.id,
        status: 'AWAITING_COUNTERPARTY',
        share_token: shareToken,
        net_amount: fees.sellerReceives,
        platform_fee: fees.platformFee,
        fee_breakdown: fees,
      }).select().single();

      if (error) throw error;

      await supabase.from('audit_logs').insert({ deal_id: data.id, action: 'DEAL_CREATED', actor_id: profile.id, details: { amount: formData.amount, creator_role: creatorRole } });
      toast.success('Deal contract created successfully');
      navigate(`/deals/${data.id}`);
    } catch (err) { console.error(err); toast.error('Failed to create deal. Please try again.'); }
    finally { setLoading(false); }
  };

  return (
    <div className="page-wrapper create-deal-page">
      <div className="container-md">
        <div className="page-header text-center">
          <h1>Initiate Transaction</h1>
          <p>Create a secure escrow contract — share the link with your counterparty</p>
        </div>

        <div className="create-deal-layout">
          <div className="glass-card">
            <form onSubmit={handleSubmit} className="deal-form">
              <div className="form-section">
                <h3 className="section-title">I am the...</h3>
                <div className="role-toggle">
                  <button
                    type="button"
                    className={`role-btn ${creatorRole === 'BUYER' ? 'active' : ''}`}
                    onClick={() => setCreatorRole('BUYER')}
                  >
                    <span className="role-icon">🛒</span>
                    <span className="role-label">Buyer</span>
                    <span className="role-desc">I want to purchase something</span>
                  </button>
                  <button
                    type="button"
                    className={`role-btn ${creatorRole === 'SELLER' ? 'active' : ''}`}
                    onClick={() => setCreatorRole('SELLER')}
                  >
                    <span className="role-icon">📦</span>
                    <span className="role-label">Seller</span>
                    <span className="role-desc">I want to sell something</span>
                  </button>
                </div>
              </div>

              <div className="form-section">
                <h3 className="section-title">Contract Details</h3>
                <div className="form-group">
                  <label className="form-label">Transaction Title</label>
                  <input name="title" className="form-input form-input-lg" placeholder="e.g. Graphic Design Services" value={formData.title} onChange={handleChange} required maxLength={200} />
                </div>
                <div className="form-group">
                  <label className="form-label">Terms & Description</label>
                  <textarea name="description" className="form-textarea" placeholder="Clearly outline deliverables, timelines, and conditions for this transaction..." value={formData.description} onChange={handleChange} maxLength={5000} />
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

              <button type="submit" className="btn btn-primary btn-full btn-lg create-btn" disabled={loading || !creatorRole}>
                {loading ? <><span className="spinner spinner-sm"></span>Initializing Contract...</> : `Create Contract — ${formatGHS(fees.totalPayable || 0)}`}
              </button>

              <p className="create-deal-note">
                After creating, you'll get a share link to send to your counterparty so they can join the escrow.
              </p>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}
