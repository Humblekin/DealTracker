import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';
import DealCard from '../components/DealCard';
import { formatGHS } from '../utils/fees';
import { DEAL_STATUS } from '../utils/constants';
import toast from 'react-hot-toast';
import './Dashboard.css';

export default function Dashboard() {
  const { profile, refreshProfile } = useAuth();
  const [deals, setDeals] = useState([]);
  const [stats, setStats] = useState({ total: 0, active: 0, completed: 0, disputed: 0, totalValue: 0 });
  const [loading, setLoading] = useState(true);
  const [phone, setPhone] = useState('');
  const [network, setNetwork] = useState('');
  const [savingPayout, setSavingPayout] = useState(false);

  useEffect(() => {
    if (profile) {
      fetchDeals();
    } else {
      setLoading(false);
    }
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
      const total = data?.length || 0;
      const active = data?.filter(d => d.status === DEAL_STATUS.IN_ESCROW).length || 0;
      const completed = data?.filter(d => d.status === DEAL_STATUS.COMPLETED).length || 0;
      const disputed = data?.filter(d => d.status === DEAL_STATUS.DISPUTED).length || 0;
      const totalValue = data?.reduce((sum, d) => sum + parseFloat(d.amount || 0), 0) || 0;
      setStats({ total, active, completed, disputed, totalValue });
    } catch (err) { console.error(err); }
    finally { setLoading(false); }
  }

  async function handleSavePayout() {
    const p = phone.trim();
    const n = network;
    if (!p || !n) { toast.error('Enter your phone number and select a network'); return; }
    if (!/^\d{10,12}$/.test(p.replace(/[^0-9]/g, ''))) { toast.error('Enter a valid phone number'); return; }
    setSavingPayout(true);
    try {
      const { error } = await supabase.from('profiles').update({ phone: p, network: n }).eq('id', profile.id);
      if (error) throw error;
      toast.success('Payout details saved');
      setPhone('');
      setNetwork('');
      refreshProfile();
    } catch (err) { console.error(err); toast.error('Failed to save payout details.'); }
    finally { setSavingPayout(false); }
  }

  if (loading) return <div className="loading-screen"><div className="spinner"></div><p>Loading dashboard...</p></div>;

  return (
    <div className="page-wrapper dashboard-wrapper">
      <div className="dashboard-hero-bg"></div>
      <div className="container">
        <div className="dashboard-header">
          <div>
            <h1 className="dashboard-greeting">
              {new Date().getHours() < 12 ? 'Good morning' : new Date().getHours() < 18 ? 'Good afternoon' : 'Good evening'}, <span className="gradient-text">{profile?.full_name || 'User'}</span>
            </h1>
            <p className="dashboard-role">{profile?.role === 'admin' ? '⚙️ Admin Workspace' : '👤 DealGuider User'}</p>
          </div>
          {profile?.role !== 'admin' && (
            <Link to="/deals/create" className="btn btn-primary btn-lg create-deal-btn">
              <span className="btn-icon">＋</span> New Deal
            </Link>
          )}
        </div>

        <div className="stats-grid dashboard-stats">
          <div className="stat-card">
            <div className="stat-label">Total Deals</div>
            <div className="stat-value">{stats.total}</div>
          </div>
          <div className="stat-card stat-accent">
            <div className="stat-label">Active Deals</div>
            <div className="stat-value accent">{stats.active}</div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Completed</div>
            <div className="stat-value">{stats.completed}</div>
          </div>
          <div className="stat-card stat-wide">
            <div className="stat-label">Total Volume</div>
            <div className="stat-value">{formatGHS(stats.totalValue)}</div>
          </div>
        </div>

        <div className="payout-card glass-card">
          <div className="payout-card-header">
            <div className="payout-icon-wrap">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="5" width="20" height="14" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/></svg>
            </div>
            <div className="payout-card-title">
              <h3>Payout Configuration</h3>
              <p>Set your mobile money number to receive deal settlements</p>
            </div>
          </div>
          
          {profile.phone && profile.network ? (
            <div className="payout-configured">
              <div className="configured-info">
                <span className="network-badge">{profile.network.toUpperCase()}</span>
                <span className="phone-number">{profile.phone}</span>
              </div>
              <button className="btn btn-ghost btn-sm" onClick={() => { setPhone(profile.phone); setNetwork(profile.network); }}>Edit</button>
            </div>
          ) : null}

          {(!profile.phone || !profile.network || phone || network) && (
            <div className="payout-form">
              <div className="payout-row">
                <select className="form-select payout-network" value={network} onChange={e => setNetwork(e.target.value)}>
                  <option value="">Select Network</option>
                  <option value="mtn">MTN Mobile Money</option>
                  <option value="vodafone">Telecel Cash</option>
                  <option value="tigo">AT Money</option>
                </select>
                <input
                  type="tel"
                  className="form-input payout-phone"
                  placeholder="Enter mobile number"
                  value={phone}
                  onChange={e => setPhone(e.target.value)}
                />
                <button className="btn btn-primary payout-save-btn" onClick={handleSavePayout} disabled={savingPayout}>
                  {savingPayout ? <span className="spinner spinner-sm"></span> : 'Save Details'}
                </button>
              </div>
            </div>
          )}
        </div>

        <div className="dashboard-content">
          <div className="content-header">
            <h2>Recent Transactions</h2>
            {deals.length > 5 && (
              <Link to="/transactions" className="btn btn-ghost btn-sm">View All</Link>
            )}
          </div>
          
          {deals.length === 0 ? (
            <div className="empty-state glass-card">
              <div className="empty-state-icon">
                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>
              </div>
              <h3>No Deals Found</h3>
              <p>You haven't participated in any transactions yet.</p>
              {profile?.role !== 'admin' && (
                <Link to="/deals/create" className="btn btn-primary mt-4">Start New Deal</Link>
              )}
            </div>
          ) : (
            <div className="deals-grid">
              {deals.slice(0, 8).map(deal => (
                <DealCard key={deal.id} deal={deal} userId={profile?.id} />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
