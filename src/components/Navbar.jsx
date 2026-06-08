import { useAuth } from '../contexts/AuthContext';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useState, useEffect, useRef } from 'react';
import { supabase } from '../lib/supabase';
import './Navbar.css';

export default function Navbar({ isAdminLayout = false }) {
  const { user, profile, signOut } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);
  const [notifications, setNotifications] = useState([]);
  const [showNotifs, setShowNotifs] = useState(false);
  const notifRef = useRef(null);

  useEffect(() => {
    if (!user) return;
    fetchNotifications();
    const channel = supabase.channel('notifications')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications', filter: `user_id=eq.${user.id}` }, () => fetchNotifications())
      .subscribe();
    const handleClick = (e) => { if (notifRef.current && !notifRef.current.contains(e.target)) setShowNotifs(false); };
    document.addEventListener('mousedown', handleClick);
    return () => { supabase.removeChannel(channel); document.removeEventListener('mousedown', handleClick); };
  }, [user]);

  async function fetchNotifications() {
    const { data } = await supabase.from('notifications').select('*').eq('user_id', user.id).order('created_at', { ascending: false }).limit(20);
    if (data) setNotifications(data);
  }

  async function markRead(id) {
    await supabase.from('notifications').update({ is_read: true }).eq('id', id);
    setNotifications(prev => prev.map(n => n.id === id ? { ...n, is_read: true } : n));
  }

  const unreadCount = notifications.filter(n => !n.is_read).length;

  const handleSignOut = async () => {
    try {
      await signOut();
    } finally {
      window.location.href = '/';
    }
  };

  const navLinks = getNavLinks(profile?.role);
  const isActive = (path) => location.pathname === path;

  return (
    <nav className={`navbar ${isAdminLayout ? 'navbar-admin' : ''}`}>
      <div className="navbar-inner container">
        {!isAdminLayout && (
          <Link to={user ? '/dashboard' : '/'} className="navbar-brand">
            <div className="brand-icon-wrap">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
                <path d="M12 2L3 7v10l9 5 9-5V7l-9-5z" fill="url(#nav-grad)" opacity="0.9"/>
                <path d="M12 2L3 7l9 5 9-5-9-5z" fill="url(#nav-grad)" opacity="0.6"/>
                <defs>
                  <linearGradient id="nav-grad" x1="3" y1="2" x2="21" y2="22">
                    <stop stopColor="#00d4aa"/>
                    <stop offset="1" stopColor="#00b4d8"/>
                  </linearGradient>
                </defs>
              </svg>
            </div>
            <span className="brand-text">Secure<span className="brand-accent">Trade</span></span>
          </Link>
        )}

        {isAdminLayout && <div className="navbar-spacer" />}

        {user && (
          <>
            {!isAdminLayout && (
              <div className={`navbar-links ${menuOpen ? 'open' : ''}`}>
                {navLinks.map((link) => (
                  <Link
                    key={link.path}
                    to={link.path}
                    className={`nav-link ${isActive(link.path) ? 'active' : ''}`}
                    onClick={() => setMenuOpen(false)}
                  >
                    <span className="nav-link-icon">{link.icon}</span>
                    <span>{link.label}</span>
                  </Link>
                ))}
              </div>
            )}

            <div className="navbar-right">
              <div className="notif-bell-wrapper" ref={notifRef}>
                <button className="notif-bell" onClick={() => setShowNotifs(!showNotifs)} aria-label="Notifications">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>
                  {unreadCount > 0 && <span className="notif-badge">{unreadCount > 9 ? '9+' : unreadCount}</span>}
                </button>
                {showNotifs && (
                  <div className="notif-dropdown">
                    <div className="notif-header">
                      <span>Notifications</span>
                      <span className="notif-count">{unreadCount} new</span>
                    </div>
                    <div className="notif-list">
                      {notifications.length === 0 && <div className="notif-empty">No notifications yet</div>}
                      {notifications.map(n => (
                          <div key={n.id} className={`notif-item ${n.is_read ? '' : 'unread'}`} onClick={() => markRead(n.id)}>
                          <div className="notif-title">{n.title}</div>
                          <div className="notif-msg">{n.message}</div>
                          <div className="notif-time">{new Date(n.created_at).toLocaleDateString('en-GH', { month: 'short', day: 'numeric' })}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              <div className="navbar-user">
                <div className="user-avatar">
                  {profile?.full_name?.charAt(0)?.toUpperCase() || 'U'}
                </div>
                <div className="user-info">
                  <span className="user-name">{profile?.full_name || 'User'}</span>
                </div>
              </div>

              {!isAdminLayout && (
                <button className="btn-logout" onClick={handleSignOut}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4" />
                    <polyline points="16 17 21 12 16 7" />
                    <line x1="21" y1="12" x2="9" y2="12" />
                  </svg>
                  <span>Logout</span>
                </button>
              )}

              <button
                className={`hamburger ${menuOpen ? 'open' : ''}`}
                onClick={() => setMenuOpen(!menuOpen)}
                aria-label="Toggle menu"
              >
                <span></span>
                <span></span>
                <span></span>
              </button>
            </div>
          </>
        )}

        {!user && (
          <div className="navbar-right">
            <Link to="/login" className="btn btn-ghost">Login</Link>
            <Link to="/register" className="btn btn-primary btn-sm">Get Started</Link>
          </div>
        )}
      </div>
    </nav>
  );
}

function getNavLinks(role) {
  const common = [
    { path: '/dashboard', label: 'Dashboard', icon: '📊' },
  ];

  if (role === 'admin') {
    return [
      ...common,
      { path: '/admin', label: 'Admin Panel', icon: '⚙️' },
      { path: '/transactions', label: 'Transactions', icon: '📋' },
    ];
  }

  return [
    ...common,
    { path: '/deals/create', label: 'New Deal', icon: '➕' },
    { path: '/transactions', label: 'Transactions', icon: '📋' },
  ];
}
