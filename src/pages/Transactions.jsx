import { useState, useEffect } from 'react';
import { useAuth } from '../hooks/useAuth';
import { supabase } from '../lib/supabase';
import DealCard from '../components/DealCard';
import DealGuiderMascot from '../components/DealGuiderMascot';
import { DEAL_STATUS, PAYMENT_STATUS } from '../utils/constants';
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

const PAYMENT_FILTERS = [
  { value: 'ALL', label: 'All Payments' },
  { value: PAYMENT_STATUS.SUCCESS, label: 'Successful' },
  { value: PAYMENT_STATUS.PROCESSING, label: 'Processing' },
  { value: PAYMENT_STATUS.PENDING, label: 'Pending' },
  { value: PAYMENT_STATUS.INITIALIZED, label: 'Initialized' },
  { value: PAYMENT_STATUS.FAILED, label: 'Failed' },
  { value: PAYMENT_STATUS.ABANDONED, label: 'Abandoned' },
  { value: PAYMENT_STATUS.REVERSED, label: 'Reversed' },
];

export default function Transactions() {
  const { profile } = useAuth();
  const [deals, setDeals] = useState([]);
  const [filter, setFilter] = useState('ALL');
  const [paymentFilter, setPaymentFilter] = useState('ALL');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    const finish = () => { if (!cancelled) setLoading(false); };

    if (!profile) {
      Promise.resolve().then(finish);
      return () => { cancelled = true; };
    }

    let query = supabase.from('deals').select('*');
    if (profile.role !== 'admin') {
      query = query.or(`buyer_id.eq.${profile.id},seller_id.eq.${profile.id}`);
    }
    query.order('created_at', { ascending: false }).then(({ data, error }) => {
      if (cancelled) return;
      if (error) throw error;
      setDeals(data || []);
    }).catch(err => console.error(err)).then(finish);

    return () => { cancelled = true; };
  }, [profile]);

  const filtered = deals.filter(d =>
    (filter === 'ALL' || d.status === filter) &&
    (paymentFilter === 'ALL' || d.payment_status === paymentFilter)
  );

  if (loading) return <div className="loading-screen"><div className="spinner"></div></div>;

  return (
    <div className="page-wrapper transactions-page">
      <div className="container">
        <div className="transactions-heading">
          <div>
            <p className="transactions-eyebrow">Your activity</p>
            <h1>Transaction history</h1>
            <p>Monitor and manage all your secure deals in one place.</p>
          </div>
          <div className="transactions-total" aria-live="polite">
            <strong>{filtered.length}</strong>
            <span>of {deals.length} deals shown</span>
          </div>
        </div>

        <div className="transaction-filters">
          <section className="transaction-filter-group" aria-label="Filter by deal status">
            <h2>Deal status</h2>
            <div className="filter-bar">
              {STATUS_FILTERS.map(f => {
                const count = deals.filter(d => d.status === f.value).length;
                if (f.value !== 'ALL' && count === 0) return null;

                return (
                  <button
                    key={f.value}
                    className={`filter-btn ${filter === f.value ? 'active' : ''}`}
                    onClick={() => setFilter(f.value)}
                    aria-pressed={filter === f.value}
                  >
                    {f.label}
                    {f.value !== 'ALL' && <span className="filter-count">{count}</span>}
                  </button>
                );
              })}
            </div>
          </section>

          <section className="transaction-filter-group" aria-label="Filter by payment status">
            <h2>Payment status</h2>
            <div className="filter-bar">
              {PAYMENT_FILTERS.map(f => {
                const count = deals.filter(d => d.payment_status === f.value).length;
                if (f.value !== 'ALL' && count === 0) return null;

                return (
                  <button
                    key={f.value}
                    className={`filter-btn ${paymentFilter === f.value ? 'active' : ''}`}
                    onClick={() => setPaymentFilter(f.value)}
                    aria-pressed={paymentFilter === f.value}
                  >
                    {f.label}
                    {f.value !== 'ALL' && <span className="filter-count">{count}</span>}
                  </button>
                );
              })}
            </div>
          </section>
        </div>

        {filtered.length === 0 ? (
          <div className="empty-state glass-card">
            <DealGuiderMascot
              variant="empty-transactions"
              size="xl"
              alt="Kofi holding a clipboard awaiting transaction records"
            />
            <h3 style={{ marginTop: '16px' }}>
              {deals.length === 0 ? 'No transactions yet' : 'No matching transactions'}
            </h3>
            <p>
              {deals.length === 0
                ? 'Your completed, active, and pending escrow deals will appear here once you get started.'
                : 'No deals match the selected status or payment filters.'}
            </p>
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
