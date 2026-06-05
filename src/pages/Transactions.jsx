import { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';
import DealCard from '../components/DealCard';
import { DEAL_STATUS } from '../utils/constants';
import './Transactions.css';

const STATUS_FILTERS = [
  { value: 'ALL', label: 'All Transactions' },
  { value: DEAL_STATUS.AWAITING_COUNTERPARTY, label: 'Awaiting Counterparty' },
  { value: DEAL_STATUS.AWAITING_PAYMENT, label: 'Awaiting Payment' },
  { value: DEAL_STATUS.IN_ESCROW, label: 'Secured in Escrow' },
  { value: DEAL_STATUS.DELIVERED, label: 'Delivered' },
  { value: DEAL_STATUS.COMPLETED, label: 'Completed' },
  { value: DEAL_STATUS.DISPUTED, label: 'Disputed' },
  { value: DEAL_STATUS.REFUNDED, label: 'Refunded' },
  { value: DEAL_STATUS.CANCELLED, label: 'Cancelled' },
];

export default function Transactions() {
  const { profile } = useAuth();
  const [deals, setDeals] = useState([]);
  const [filter, setFilter] = useState('ALL');
  const [loading, setLoading] = useState(true);

  useEffect(() => { 
    if (profile) fetchDeals(); 
    else setLoading(false);
  }, [profile]);

  async function fetchDeals() {
    try {
      let query = supabase.from('deals').select('*, buyer_profile:profiles!buyer_id(full_name), seller_profile:profiles!seller_id(full_name)');
      if (profile.role !== 'admin') {
        query = query.or(`buyer_id.eq.${profile.id},seller_id.eq.${profile.id}`);
      }
      const { data, error } = await query.order('created_at', { ascending: false });
      if (error) throw error;
      setDeals(data || []);
    } catch (err) { console.error(err); }
    finally { setLoading(false); }
  }

  const filtered = filter === 'ALL' ? deals : deals.filter(d => d.status === filter);

  if (loading) return <div className="loading-screen"><div className="spinner"></div></div>;

  return (
    <div className="page-wrapper transactions-page">
      <div className="container">
        <div className="page-header text-center">
          <h1>Transaction History</h1>
          <p>Monitor and manage all your secure deals in one place</p>
        </div>
        
        <div className="filter-bar">
          {STATUS_FILTERS.map(f => {
            const count = deals.filter(d => d.status === f.value).length;
            if (f.value !== 'ALL' && count === 0) return null; // Hide empty filters
            
            return (
              <button 
                key={f.value} 
                className={`filter-btn ${filter === f.value ? 'active' : ''}`} 
                onClick={() => setFilter(f.value)}
              >
                {f.label}
                {f.value !== 'ALL' && <span className="filter-count">{count}</span>}
              </button>
            )
          })}
        </div>
        
        {filtered.length === 0 ? (
          <div className="empty-state glass-card">
            <div className="empty-state-icon">
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>
            </div>
            <h3>No transactions found</h3>
            <p>No deals match the selected status.</p>
          </div>
        ) : (
          <div className="deals-grid">
            {filtered.map(deal => <DealCard key={deal.id} deal={deal} userId={profile?.id} />)}
          </div>
        )}
      </div>
    </div>
  );
}
