import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import './AdminSidebar.css';

const ADMIN_NAV = [
  {
    section: 'Overview',
    items: [
      { path: '/admin', label: 'Dashboard', icon: DashboardIcon, exact: true },
      { path: '/admin/deals', label: 'All Deals', icon: DealsIcon },
      { path: '/admin/disputes', label: 'Disputes', icon: DisputeIcon },
      { path: '/admin/users', label: 'Users', icon: UsersIcon },
    ],
  },
  {
    section: 'Finance',
    items: [
      { path: '/transactions', label: 'Transactions', icon: TransactionIcon },
    ],
  },
];

export default function AdminSidebar() {
  const { profile, signOut } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [collapsed, setCollapsed] = useState(false);

  const isActive = (path, exact) => {
    if (exact) return location.pathname === path;
    return location.pathname.startsWith(path);
  };

  const handleSignOut = async () => {
    try {
      await signOut();
    } finally {
      window.location.href = '/';
    }
  };

  return (
    <aside className={`admin-sidebar ${collapsed ? 'collapsed' : ''}`}>
      {/* Brand */}
      <div className="sidebar-header">
        <Link to="/admin" className="sidebar-brand">
          <div className="sidebar-brand-icon">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
              <path d="M12 2L3 7v10l9 5 9-5V7l-9-5z" fill="url(#brand-grad)" opacity="0.9"/>
              <path d="M12 2L3 7l9 5 9-5-9-5z" fill="url(#brand-grad)" opacity="0.6"/>
              <path d="M12 12l-9-5v10l9 5V12z" fill="url(#brand-grad)" opacity="0.4"/>
              <defs>
                <linearGradient id="brand-grad" x1="3" y1="2" x2="21" y2="22">
                  <stop stopColor="#00d4aa"/>
                  <stop offset="1" stopColor="#00b4d8"/>
                </linearGradient>
              </defs>
            </svg>
          </div>
          {!collapsed && (
            <span className="sidebar-brand-text">
              Secure<span className="brand-accent">Trade</span>
            </span>
          )}
        </Link>
        <button
          className="sidebar-toggle"
          onClick={() => setCollapsed(!collapsed)}
          aria-label="Toggle sidebar"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            {collapsed ? (
              <polyline points="9 18 15 12 9 6" />
            ) : (
              <polyline points="15 18 9 12 15 6" />
            )}
          </svg>
        </button>
      </div>

      {/* Navigation */}
      <nav className="sidebar-nav">
        {ADMIN_NAV.map((section) => (
          <div key={section.section} className="sidebar-section">
            {!collapsed && (
              <div className="sidebar-section-label">{section.section}</div>
            )}
            <ul className="sidebar-menu">
              {section.items.map((item) => (
                <li key={item.path}>
                  <Link
                    to={item.path}
                    className={`sidebar-link ${isActive(item.path, item.exact) ? 'active' : ''}`}
                    title={collapsed ? item.label : undefined}
                  >
                    <span className="sidebar-link-icon">
                      <item.icon />
                    </span>
                    {!collapsed && <span className="sidebar-link-text">{item.label}</span>}
                    {!collapsed && isActive(item.path, item.exact) && (
                      <span className="sidebar-active-dot" />
                    )}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </nav>

      {/* User Section */}
      <div className="sidebar-footer">
        <div className="sidebar-user">
          <div className="sidebar-user-avatar">
            {profile?.full_name?.charAt(0)?.toUpperCase() || 'A'}
          </div>
          {!collapsed && (
            <div className="sidebar-user-info">
              <span className="sidebar-user-name">{profile?.full_name || 'Admin'}</span>
              <span className="sidebar-user-role">Administrator</span>
            </div>
          )}
        </div>
        <button
          className="sidebar-logout"
          onClick={handleSignOut}
          title="Sign out"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4" />
            <polyline points="16 17 21 12 16 7" />
            <line x1="21" y1="12" x2="9" y2="12" />
          </svg>
        </button>
      </div>
    </aside>
  );
}

/* SVG Icon Components */
function DashboardIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
      <rect x="14" y="14" width="7" height="7" rx="1" />
    </svg>
  );
}

function DealsIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="16" y1="13" x2="8" y2="13" />
      <line x1="16" y1="17" x2="8" y2="17" />
      <polyline points="10 9 9 9 8 9" />
    </svg>
  );
}

function DisputeIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
      <line x1="12" y1="9" x2="12" y2="13" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  );
}

function UsersIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 00-3-3.87" />
      <path d="M16 3.13a4 4 0 010 7.75" />
    </svg>
  );
}

function TransactionIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <line x1="12" y1="1" x2="12" y2="23" />
      <path d="M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6" />
    </svg>
  );
}
