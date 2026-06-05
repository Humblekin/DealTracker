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
  const [editingDeal, setEditingDeal] = useState(null);
  const [editingUser, setEditingUser] = useState(null);
  const [deletingTarget, setDeletingTarget] = useState(null);
  const [deletingType, setDeletingType] = useState(null);
  const [editForm, setEditForm] = useState({});

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
      
      const paidDeals = d.filter(x => x.status !== 'AWAITING_PAYMENT');
      const platformProfit = paidDeals.reduce((s, x) => s + (parseFloat(parseFees(x).platformFee) || 0), 0);
      
      setStats({
        totalDeals: d.length,
        activeEscrow: d.filter(x => x.status === DEAL_STATUS.IN_ESCROW).length,
        openDisputes: d.filter(x => x.status === DEAL_STATUS.DISPUTED).length,
        completed: d.filter(x => x.status === DEAL_STATUS.COMPLETED).length,
        totalVolume: d.reduce((s, x) => s + parseFloat(x.amount || 0), 0),
        platformProfit,
      });
    } catch (err) { 
      console.error(err); 
      toast.error('Failed to load dashboard data.');
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
        { user_id: deal.seller_id, title: 'Payment Sent!', message: `Funds for "${deal.title}" have been sent.`, type: 'payment', deal_id: dealId },
        { user_id: deal.buyer_id, title: 'Deal Complete', message: `"${deal.title}" is complete. Your funds have been released to the seller.`, type: 'info', deal_id: dealId },
      ]);
      toast.success('Deal completed and seller notified.');
      loadAll();
    } catch (err) { console.error(err); toast.error('Operation failed. Please try again.'); }
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
        { user_id: deal.buyer_id, title: 'Refund Sent!', message: `Funds for "${deal.title}" have been refunded.`, type: 'payment', deal_id: dealId },
        { user_id: deal.seller_id, title: 'Deal Refunded', message: `"${deal.title}" was refunded to the buyer by admin.`, type: 'info', deal_id: dealId },
      ]);
      toast.success('Buyer refunded and notified.');
      loadAll();
    } catch (err) { console.error(err); toast.error('Operation failed. Please try again.'); }
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
    } catch (err) { console.error(err); toast.error('Failed to update role.'); }
    finally { setActionLoading(null); }
  }

  function openEditDeal(deal) {
    setEditingDeal(deal);
    setEditForm({
      title: deal.title,
      description: deal.description || '',
      amount: deal.amount,
      status: deal.status,
    });
  }

  async function handleSaveDeal() {
    if (!editingDeal) return;
    setActionLoading(`edit_${editingDeal.id}`);
    try {
      const { error } = await supabase.from('deals').update(editForm).eq('id', editingDeal.id);
      if (error) throw error;
      toast.success('Deal updated.');
      setEditingDeal(null);
      loadAll();
    } catch (err) { console.error(err); toast.error('Failed to update deal.'); }
    finally { setActionLoading(null); }
  }

  function confirmDeleteDeal(deal) {
    setDeletingTarget(deal);
    setDeletingType('deal');
  }

  async function handleDeleteDeal() {
    if (!deletingTarget) return;
    setActionLoading(`del_${deletingTarget.id}`);
    try {
      const { error } = await supabase.from('deals').delete().eq('id', deletingTarget.id);
      if (error) throw error;
      toast.success('Deal deleted.');
      setDeletingTarget(null);
      loadAll();
    } catch (err) { console.error(err); toast.error('Failed to delete deal.'); }
    finally { setActionLoading(null); }
  }

  function openEditUser(user) {
    setEditingUser(user);
    setEditForm({
      full_name: user.full_name,
      email: user.email || '',
      phone: user.phone || '',
      network: user.network || '',
    });
  }

  async function handleSaveUser() {
    if (!editingUser) return;
    setActionLoading(`edit_${editingUser.id}`);
    try {
      const { error } = await supabase.from('profiles').update(editForm).eq('id', editingUser.id);
      if (error) throw error;
      toast.success('User updated.');
      setEditingUser(null);
      loadAll();
    } catch (err) { console.error(err); toast.error('Failed to update user.'); }
    finally { setActionLoading(null); }
  }

  function confirmDeleteUser(user) {
    setDeletingTarget(user);
    setDeletingType('user');
  }

  async function handleDeleteUser() {
    if (!deletingTarget) return;
    setActionLoading(`del_${deletingTarget.id}`);
    try {
      const { error } = await supabase.from('profiles').delete().eq('id', deletingTarget.id);
      if (error) throw error;
      toast.success('User deleted.');
      setDeletingTarget(null);
      loadAll();
    } catch (err) { console.error(err); toast.error('Failed to delete user.'); }
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
              <thead><tr><th>Title</th><th>Creator</th><th>Buyer</th><th>Seller</th><th>Amount</th><th>Profit</th><th>Status</th><th>Actions</th></tr></thead>
              <tbody>
                {deals.map(d => (
                  <tr key={d.id}>
                    <td><Link to={`/deals/${d.id}`}>{d.title}</Link></td>
                    <td>
                      {(d.creator_role === 'BUYER' ? d.buyer_profile?.full_name : d.seller_profile?.full_name) || '—'}
                      <span className="creator-tag">{d.creator_role}</span>
                    </td>
                    <td>{d.buyer_profile?.full_name || <span className="text-muted">Awaiting...</span>}</td>
                    <td>{d.seller_profile?.full_name || <span className="text-muted">Awaiting...</span>}</td>
                    <td className="amount-cell">{formatGHS(d.amount)}</td>
                    <td className="profit-cell">
                      {!['AWAITING_COUNTERPARTY', 'AWAITING_PAYMENT', 'CANCELLED'].includes(d.status)
                        ? formatGHS(parseFloat(parseFees(d).platformFee) || 0)
                        : '—'}
                    </td>
                    <td><StatusBadge status={d.status} /></td>
                    <td>
                      <div className="admin-actions">
                        {[DEAL_STATUS.IN_ESCROW, DEAL_STATUS.DISPUTED].includes(d.status) && (
                          <>
                            <button className="btn btn-sm btn-success" onClick={() => handleForceRelease(d.id)} disabled={actionLoading === d.id}>Release</button>
                            <button className="btn btn-sm btn-danger" onClick={() => handleForceRefund(d.id)} disabled={actionLoading === d.id}>Refund</button>
                          </>
                        )}
                        {['COMPLETED', 'REFUNDED', 'CANCELLED'].includes(d.status) && (
                          <span className="action-done">{d.status}</span>
                        )}
                        <button className="admin-action-btn edit" onClick={() => openEditDeal(d)} disabled={actionLoading === `edit_${d.id}`}>Edit</button>
                        <button className="admin-action-btn del" onClick={() => confirmDeleteDeal(d)} disabled={actionLoading === `del_${d.id}`}>Del</button>
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
                      <div className="admin-actions">
                        {profile.id !== u.id ? (
                          <>
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
                            <button className="admin-action-btn edit" onClick={() => openEditUser(u)} disabled={actionLoading === `edit_${u.id}`}>Edit</button>
                            <button className="admin-action-btn del" onClick={() => confirmDeleteUser(u)} disabled={actionLoading === `del_${u.id}`}>Del</button>
                          </>
                        ) : (
                          <span className="text-muted" style={{ fontSize: '0.85rem' }}>Current User</span>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {deletingTarget && (
        <div className="modal-overlay" onClick={() => setDeletingTarget(null)}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Confirm Delete</h2>
              <button className="modal-close" onClick={() => setDeletingTarget(null)}>&times;</button>
            </div>
            <div className="modal-body">
              <p className="confirm-text">
                Delete {deletingType === 'deal' ? 'deal' : 'user'} <strong>{deletingTarget.title || deletingTarget.full_name}</strong>?
              </p>
              <p className="confirm-sub">This action cannot be undone. All related data may be affected.</p>
            </div>
            <div className="modal-footer">
              <button className="btn btn-ghost" onClick={() => setDeletingTarget(null)}>Cancel</button>
              <button className="btn btn-danger" onClick={deletingType === 'deal' ? handleDeleteDeal : handleDeleteUser} disabled={actionLoading}>
                {actionLoading ? 'Deleting...' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}

      {(editingDeal || editingUser) && (
        <div className="modal-overlay" onClick={() => { setEditingDeal(null); setEditingUser(null); }}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2>{editingDeal ? 'Edit Deal' : 'Edit User'}</h2>
              <button className="modal-close" onClick={() => { setEditingDeal(null); setEditingUser(null); }}>&times;</button>
            </div>
            <div className="modal-body">
              {editingDeal ? (
                <>
                  <div className="form-group">
                    <label>Title</label>
                    <input className="form-input" value={editForm.title || ''} onChange={e => setEditForm({...editForm, title: e.target.value})} />
                  </div>
                  <div className="form-group">
                    <label>Description</label>
                    <textarea className="form-input" rows={3} value={editForm.description || ''} onChange={e => setEditForm({...editForm, description: e.target.value})} />
                  </div>
                  <div className="form-group">
                    <label>Amount (GHS)</label>
                    <input className="form-input" type="number" step="0.01" value={editForm.amount || ''} onChange={e => setEditForm({...editForm, amount: e.target.value})} />
                  </div>
                  <div className="form-group">
                    <label>Status</label>
                    <select className="form-input" value={editForm.status || ''} onChange={e => setEditForm({...editForm, status: e.target.value})}>
                      {Object.entries(DEAL_STATUS).map(([key, val]) => <option key={key} value={val}>{key}</option>)}
                    </select>
                  </div>
                </>
              ) : (
                <>
                  <div className="form-group">
                    <label>Full Name</label>
                    <input className="form-input" value={editForm.full_name || ''} onChange={e => setEditForm({...editForm, full_name: e.target.value})} />
                  </div>
                  <div className="form-group">
                    <label>Email</label>
                    <input className="form-input" value={editForm.email || ''} onChange={e => setEditForm({...editForm, email: e.target.value})} />
                  </div>
                  <div className="form-group">
                    <label>Phone</label>
                    <input className="form-input" value={editForm.phone || ''} onChange={e => setEditForm({...editForm, phone: e.target.value})} />
                  </div>
                  <div className="form-group">
                    <label>Network</label>
                    <select className="form-input" value={editForm.network || ''} onChange={e => setEditForm({...editForm, network: e.target.value})}>
                      <option value="">Select</option>
                      <option value="mtn">MTN</option>
                      <option value="vodafone">Vodafone</option>
                      <option value="tigo">Tigo</option>
                    </select>
                  </div>
                </>
              )}
            </div>
            <div className="modal-footer">
              <button className="btn btn-ghost" onClick={() => { setEditingDeal(null); setEditingUser(null); }}>Cancel</button>
              <button className="btn btn-primary" onClick={editingDeal ? handleSaveDeal : handleSaveUser} disabled={actionLoading}>
                {actionLoading ? 'Saving...' : 'Save Changes'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
