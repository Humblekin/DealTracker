import { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import './UserSidebar.css';

const USER_NAV = [
  {
    section: 'Main',
    items: [
      { path: '/dashboard', label: 'Dashboard', icon: DashboardIcon, exact: true },
      { path: '/deals/create', label: 'New Deal', icon: PlusIcon },
      { path: '/transactions', label: 'Transactions', icon: TransactionIcon },
      { path: '/developer', label: 'Developer', icon: CodeIcon },
    ],
  },
]

export default function UserSidebar({ mobileOpen }) {
  const { profile, signOut } = useAuth()
  const location = useLocation()
  const [collapsed, setCollapsed] = useState(false)

  const isActive = (path, exact) => {
    if (exact) return location.pathname === path
    return location.pathname.startsWith(path)
  }

  const handleSignOut = async () => {
    try {
      await signOut()
    } finally {
      window.location.href = '/'
    }
  }

  return (
    <aside className={`user-sidebar ${collapsed ? 'collapsed' : ''} ${mobileOpen ? 'mobile-open' : ''}`}>
      <div className="sidebar-header">
        <Link to="/dashboard" className="sidebar-brand">
          <div className="sidebar-brand-icon">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
              <path d="M12 2L3 7v10l9 5 9-5V7l-9-5z" fill="url(#us-grad)" opacity="0.9"/>
              <path d="M12 2L3 7l9 5 9-5-9-5z" fill="url(#us-grad)" opacity="0.6"/>
              <defs>
                <linearGradient id="us-grad" x1="3" y1="2" x2="21" y2="22">
                  <stop stopColor="#00d4aa"/>
                  <stop offset="1" stopColor="#00b4d8"/>
                </linearGradient>
              </defs>
            </svg>
          </div>
          {!collapsed && (
            <span className="sidebar-brand-text">
              Deal<span className="brand-accent">Guider</span>
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

      <nav className="sidebar-nav">
        {USER_NAV.map((section) => (
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
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
        {profile?.role === 'admin' && (
          <div className="sidebar-section">
            {!collapsed && <div className="sidebar-section-label">Admin</div>}
            <ul className="sidebar-menu">
              <li>
                <Link
                  to="/admin"
                  className={`sidebar-link ${location.pathname.startsWith('/admin') ? 'active' : ''}`}
                  title={collapsed ? 'Admin' : undefined}
                >
                  <span className="sidebar-link-icon"><ShieldIcon /></span>
                  {!collapsed && <span className="sidebar-link-text">Admin Panel</span>}
                </Link>
              </li>
            </ul>
          </div>
        )}
      </nav>

      <div className="sidebar-footer">
        <div className="sidebar-user">
          <div className="sidebar-user-avatar">
            {profile?.full_name?.charAt(0)?.toUpperCase() || 'U'}
          </div>
          {!collapsed && (
            <div className="sidebar-user-info">
              <span className="sidebar-user-name">{profile?.full_name || 'User'}</span>
              <span className="sidebar-user-role">{profile?.role || 'user'}</span>
            </div>
          )}
        </div>
        <button className="sidebar-logout" onClick={handleSignOut} title="Sign out">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4" />
            <polyline points="16 17 21 12 16 7" />
            <line x1="21" y1="12" x2="9" y2="12" />
          </svg>
        </button>
      </div>
    </aside>
  )
}

/* Icon Components */
function DashboardIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
      <rect x="14" y="14" width="7" height="7" rx="1" />
    </svg>
  )
}

function PlusIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="8" x2="12" y2="16" />
      <line x1="8" y1="12" x2="16" y2="12" />
    </svg>
  )
}

function TransactionIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <line x1="12" y1="1" x2="12" y2="23" />
      <path d="M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6" />
    </svg>
  )
}

function CodeIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="16 18 22 12 16 6" />
      <polyline points="8 6 2 12 8 18" />
    </svg>
  )
}

function ShieldIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    </svg>
  )
}
