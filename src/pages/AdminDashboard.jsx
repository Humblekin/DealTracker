import { useState, useEffect } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';
import StatusBadge from '../components/StatusBadge';
import { formatGHS } from '../utils/fees';
import { DEAL_STATUS } from '../utils/constants';
import toast from 'react-hot-toast';
import './Admin.css';

function parseFees(deal) {
  try {
    const raw = deal.fee_breakdown;
    return (typeof raw === 'string' ? JSON.parse(raw) : raw) || {};
  } catch { return {}; }
}

export default function AdminDashboard() {
  const { profile } = useAuth();
  const { tab = 'overview' } = useParams();
  const [deals, setDeals] = useState([]);
  const [disputes, setDisputes] = useState([]);
  const [users, setUsers] = useState([]);
  const [stats, setStats] = useState({});
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(null);

  useEffect(() => { loadAll(); }, []);

  async function loadAll() {
    setLoading(true);
    try {
      const [dealsRes, disputesRes, usersRes] = await Promise.all([
        supabase.from('deals').select('*, buyer_profile:profiles!buyer_id(full_name, email), seller_profile:profiles!seller_id(full_name, email, phone, network)').order('created_at', { ascending: false }),
        supabase.from('disputes').select('*, deal:deals(title)').order('created_at', { ascending: false }),
        supabase.from('profiles').select('*').order('created_at', { ascending: false }),
      ]);
      
      if (dealsRes.error) throw dealsRes.error;
      if (disputesRes.error) throw disputesRes.error;
      if (usersRes.error) throw usersRes.error;
      const d = dealsRes.data || [];
      setDeals(d);
      setDisputes(disputesRes.data || []);
      setUsers(usersRes.data || []);
      
      const paidDeals = d.filter(x => x.status !== 'PENDING_PAYMENT');
      const platformProfit = paidDeals.reduce((s, x) => s + (parseFloat(parseFees(x).platformFee) || 0), 0);
      
      setStats({
        totalDeals: d.length,
        activeEscrow: d.filter(x => x.status === DEAL_STATUS.IN_ESCROW).length,
        openDisputes: d.filter(x => x.status === DEAL_STATUS.DISPUTE_OPEN).length,
        completed: d.filter(x => x.status === DEAL_STATUS.COMPLETED).length,
        totalVolume: d.reduce((s, x) => s + parseFloat(x.amount || 0), 0),
        platformProfit,
      });
    } catch (err) { 
      console.error(err); 
      toast.error('Error fetching data: ' + err.message);
    }
    finally { setLoading(false); }
  }

  async function handleForceRelease(dealId) {
    const deal = deals.find(d => d.id === dealId);
    const payoutInfo = deal?.seller_profile?.phone
      ? `${deal.seller_profile?.full_name} on ${deal.seller_profile?.network?.toUpperCase()} (${deal.seller_profile?.phone})`
      : 'the seller';
    if (!window.confirm(`Have you sent GH₵ ${parseFloat(deal?.amount || 0).toFixed(2)} to ${payoutInfo}? Click OK only after you have manually transferred the money.`)) return;
    setActionLoading(dealId);
    try {
      await supabase.from('deals').update({ status: DEAL_STATUS.COMPLETED }).eq('id', dealId);
      await supabase.from('disputes').update({ status: 'RESOLVED', admin_decision: 'Released to seller' }).eq('deal_id', dealId).eq('status', 'OPEN');
      await supabase.from('audit_logs').insert({ deal_id: dealId, action: 'ADMIN_MANUAL_RELEASE', actor_id: profile.id, details: { note: 'Admin confirmed manual payout sent' } });
      await supabase.from('notifications').insert([
        { user_id: deal.seller_id, title: 'Payment Sent!', message: `GH₵ ${parseFloat(deal.amount).toFixed(2)} for "${deal.title}" has been sent to your mobile money.`, type: 'payment', deal_id: dealId },
        { user_id: deal.buyer_id, title: 'Deal Complete', message: `"${deal.title}" is complete. Your funds have been released to the seller.`, type: 'info', deal_id: dealId },
      ]);
      toast.success('Deal completed and seller notified.');
      loadAll();
    } catch (err) { toast.error(err.message); }
    finally { setActionLoading(null); }
  }

  async function handleForceRefund(dealId) {
    const deal = deals.find(d => d.id === dealId);
    if (!window.confirm(`Refund GH₵ ${parseFloat(deal?.amount || 0).toFixed(2)} to buyer? Only click OK if you have processed the refund.`)) return;
    setActionLoading(dealId);
    try {
      await supabase.from('deals').update({ status: DEAL_STATUS.REFUNDED }).eq('id', dealId);
      await supabase.from('disputes').update({ status: 'RESOLVED', admin_decision: 'Refunded to buyer' }).eq('deal_id', dealId).eq('status', 'OPEN');
      await supabase.from('audit_logs').insert({ deal_id: dealId, action: 'ADMIN_MANUAL_REFUND', actor_id: profile.id, details: { note: 'Admin confirmed manual refund sent' } });
      await supabase.from('notifications').insert([
        { user_id: deal.buyer_id, title: 'Refund Sent!', message: `GH₵ ${parseFloat(deal.amount).toFixed(2)} for "${deal.title}" has been refunded to you.`, type: 'payment', deal_id: dealId },
        { user_id: deal.seller_id, title: 'Deal Refunded', message: `"${deal.title}" was refunded to the buyer by admin.`, type: 'info', deal_id: dealId },
      ]);
      toast.success('Buyer refunded and notified.');
      loadAll();
    } catch (err) { toast.error(err.message); }
    finally { setActionLoading(null); }
  }

  async function handleChangeRole(userId, newRole) {
    if (!window.confirm(`Change this user's role to ${newRole.toUpperCase()}?`)) return;
    setActionLoading(`user_${userId}`);
    try {
      const { error } = await supabase.from('profiles').update({ role: newRole }).eq('id', userId);
      if (error) throw error;
      toast.success('User role updated successfully.');
      loadAll();
    } catch (err) { toast.error(err.message); }
    finally { setActionLoading(null); }
  }

  if (loading) return <div className="loading-screen"><div className="spinner"></div></div>;

  return (
    <div className="page-wrapper admin-wrapper">
      <div className="container">
        
        {/* Header based on tab */}
        <div className="page-header">
          {tab === 'overview' && (
            <>
              <h1>Dashboard Overview</h1>
              <p>Platform metrics and quick access</p>
            </>
          )}
          {tab === 'deals' && (
            <>
              <h1>All Deals</h1>
              <p>Manage and monitor platform transactions</p>
            </>
          )}
          {tab === 'disputes' && (
            <>
              <h1>Dispute Management</h1>
              <p>Resolve conflicts and process force actions</p>
            </>
          )}
          {tab === 'users' && (
            <>
              <h1>User Directory</h1>
              <p>View registered buyers, sellers, and admins</p>
            </>
          )}
        </div>

        {tab === 'overview' && (
          <>
            <div className="stats-grid">
              <div className="stat-card">
                <div className="stat-label">Total Volume</div>
                <div className="stat-value">{formatGHS(stats.totalVolume)}</div>
              </div>
              <div className="stat-card">
                <div className="stat-label">💰 Platform Profit</div>
                <div className="stat-value" style={{color:'var(--color-success)'}}>{formatGHS(stats.platformProfit)}</div>
              </div>

              <div className="stat-card">
                <div className="stat-label">Active Escrow</div>
                <div className="stat-value accent">{stats.activeEscrow}</div>
              </div>
              <div className="stat-card" style={{ borderColor: stats.openDisputes > 0 ? 'rgba(239, 68, 68, 0.3)' : '' }}>
                <div className="stat-label">Open Disputes</div>
                <div className="stat-value" style={{color: stats.openDisputes > 0 ? 'var(--color-danger)' : ''}}>{stats.openDisputes}</div>
              </div>
            </div>

            <div className="dashboard-sections">
              <div className="dashboard-section card">
                <div className="section-header-row">
                  <h3>Recent Deals</h3>
                  <Link to="/admin/deals" className="btn btn-ghost btn-sm">View All</Link>
                </div>
                <div className="table-wrapper">
                  <table className="data-table">
                    <thead><tr><th>Title</th><th>Amount</th><th>Status</th></tr></thead>
                    <tbody>
                      {deals.slice(0, 5).map(d => (
                        <tr key={d.id}>
                          <td><Link to={`/deals/${d.id}`}>{d.title}</Link></td>
                          <td style={{fontFamily:'var(--font-display)', fontWeight:600}}>{formatGHS(d.amount)}</td>
                          <td><StatusBadge status={d.status} /></td>
                        </tr>
                      ))}
                      {deals.length === 0 && <tr><td colSpan={3} className="empty-cell">No deals yet</td></tr>}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </>
        )}

        {tab === 'deals' && (
          <div className="table-wrapper">
            <table className="data-table">
              <thead><tr><th>Title</th><th>Buyer</th><th>Seller</th><th>Seller Payout</th><th>Amount</th><th>Profit</th><th>Status</th><th>Actions</th></tr></thead>
              <tbody>
                {deals.map(d => (
                  <tr key={d.id}>
                    <td><Link to={`/deals/${d.id}`}>{d.title}</Link></td>
                    <td>{d.buyer_profile?.full_name}</td>
                    <td>{d.seller_profile?.full_name}</td>
                    <td className="payout-cell">
                      {d.seller_profile?.phone
                        ? <><span className="network-tag">{d.seller_profile.network}</span> {d.seller_profile.phone}</>
                        : <span className="text-muted">—</span>}
                    </td>
                    <td className="amount-cell">{formatGHS(d.amount)}</td>
                    <td className="profit-cell">
                      {d.status !== 'PENDING_PAYMENT'
                        ? formatGHS(parseFloat(parseFees(d).platformFee) || 0)
                        : '—'}
                    </td>
                    <td><StatusBadge status={d.status} /></td>
                    <td>
                      <div className="admin-actions">
                        {[DEAL_STATUS.IN_ESCROW, DEAL_STATUS.DISPUTE_OPEN].includes(d.status) && (
                          <>
                            <button className="btn btn-sm btn-success" onClick={() => handleForceRelease(d.id)} disabled={actionLoading === d.id}>Release</button>
                            <button className="btn btn-sm btn-danger" onClick={() => handleForceRefund(d.id)} disabled={actionLoading === d.id}>Refund</button>
                          </>
                        )}
                        {['COMPLETED', 'REFUNDED'].includes(d.status) && (
                          <span className="action-done">{d.status}</span>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {tab === 'disputes' && (
          <div className="table-wrapper">
            <table className="data-table">
              <thead><tr><th>Deal</th><th>Reason</th><th>Status</th><th>Decision</th><th>Actions</th></tr></thead>
              <tbody>
                {disputes.map(d => (
                  <tr key={d.id}>
                    <td><Link to={`/deals/${d.deal_id}`}>{d.deal?.title || d.deal_id}</Link></td>
                    <td className="reason-cell">{d.reason}</td>
                    <td><span className={`badge ${d.status === 'OPEN' ? 'badge-dispute' : 'badge-completed'}`}>{d.status}</span></td>
                    <td>{d.admin_decision || '—'}</td>
                    <td>
                      {d.status === 'OPEN' && (
                        <div className="admin-actions">
                          <button className="btn btn-sm btn-success" onClick={() => handleForceRelease(d.deal_id)} disabled={actionLoading === d.deal_id}>Release</button>
                          <button className="btn btn-sm btn-danger" onClick={() => handleForceRefund(d.deal_id)} disabled={actionLoading === d.deal_id}>Refund</button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
                {disputes.length === 0 && <tr><td colSpan={5} className="empty-cell">No active disputes</td></tr>}
              </tbody>
            </table>
          </div>
        )}

        {tab === 'users' && (
          <div className="table-wrapper">
            <table className="data-table">
              <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Joined</th><th>Actions</th></tr></thead>
              <tbody>
                {users.map(u => (
                  <tr key={u.id}>
                    <td style={{ fontWeight: 500 }}>{u.full_name}</td>
                    <td className="text-muted">{u.email}</td>
                    <td><span className={`badge ${u.role === 'admin' ? 'badge-escrow' : u.role === 'seller' ? 'badge-funded' : 'badge-pending'}`}>{u.role}</span></td>
                    <td className="text-muted">{new Date(u.created_at).toLocaleDateString('en-GH', { year: 'numeric', month: 'short', day: 'numeric' })}</td>
                    <td>
                      {profile.id !== u.id ? (
                        <select 
                          className="form-input" 
                          style={{ padding: '6px 12px', fontSize: '0.85rem', width: 'auto' }}
                          value={u.role}
                          onChange={(e) => handleChangeRole(u.id, e.target.value)}
                          disabled={actionLoading === `user_${u.id}`}
                        >
                          <option value="buyer">Buyer</option>
                          <option value="seller">Seller</option>
                          <option value="admin">Admin</option>
                        </select>
                      ) : (
                        <span className="text-muted" style={{ fontSize: '0.85rem' }}>Current User</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
