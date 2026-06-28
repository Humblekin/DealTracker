import { useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import Navbar from './Navbar';
import AdminSidebar from './AdminSidebar';
import UserSidebar from './UserSidebar';
import MobileBottomNav from './MobileBottomNav';

export default function Layout() {
  const { user, profile } = useAuth();
  const location = useLocation();
  const isAdminRoute = location.pathname.startsWith('/admin');
  const isAdmin = profile?.role === 'admin';
  const showAdminSidebar = isAdmin && isAdminRoute;
  const showUserSidebar = !!user && !isAdminRoute;
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);

  if (showAdminSidebar) {
    return (
      <div className="admin-layout">
        <AdminSidebar />
        <div className="admin-main-area">
          <Navbar isAdminLayout />
          <main className="admin-content">
            <Outlet />
          </main>
        </div>
      </div>
    );
  }

  if (showUserSidebar) {
    return (
      <div className="user-layout">
        <UserSidebar mobileOpen={mobileSidebarOpen} />
        <div className="user-main-area">
          <Navbar showSidebar onToggleSidebar={() => setMobileSidebarOpen(!mobileSidebarOpen)} onOpenDrawer={() => setDrawerOpen(true)} />
          <main className="user-content" onClick={() => { setMobileSidebarOpen(false); setDrawerOpen(false) }}>
            <Outlet />
          </main>
        </div>
        <MobileBottomNav />
        {drawerOpen && <MobileDrawer onClose={() => setDrawerOpen(false)} />}
      </div>
    );
  }

  return (
    <>
      <Navbar />
      <main>
        <Outlet />
      </main>
    </>
  );
}

function MobileDrawer({ onClose }) {
  const { user, profile, signOut } = useAuth()
  const location = useLocation()

  const links = [
    { path: '/dashboard', label: 'Dashboard', icon: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg> },
    { path: '/deals/create', label: 'New Deal', icon: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/></svg> },
    { path: '/transactions', label: 'Transactions', icon: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6"/></svg> },
    { path: '/developer', label: 'Developer API', icon: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg> },
  ]

  if (profile?.role === 'admin') {
    links.push({ path: '/admin', label: 'Admin Panel', icon: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg> })
  }

  const isActive = (path) => {
    if (path === '/dashboard') return location.pathname === path
    return location.pathname.startsWith(path)
  }

  return (
    <>
      <div className="drawer-overlay" onClick={onClose} />
      <aside className="drawer">
        <div className="drawer-header">
          <div className="drawer-brand">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
              <path d="M12 2L3 7v10l9 5 9-5V7l-9-5z" fill="#00d4aa" opacity="0.9"/>
              <path d="M12 2L3 7l9 5 9-5-9-5z" fill="#00d4aa" opacity="0.6"/>
            </svg>
            <span>DealGuider</span>
          </div>
          <button className="drawer-close" onClick={onClose} aria-label="Close menu">&times;</button>
        </div>

        <nav className="drawer-nav">
          {links.map(link => (
            <a key={link.path} href={link.path} className={`drawer-link ${isActive(link.path) ? 'active' : ''}`} onClick={onClose}>
              <span className="drawer-link-icon">{link.icon}</span>
              {link.label}
            </a>
          ))}
        </nav>

        <div className="drawer-footer">
          <div className="drawer-user">
            <div className="drawer-user-avatar">
              {profile?.full_name?.charAt(0)?.toUpperCase() || 'U'}
            </div>
            <div>
              <div className="drawer-user-name">{profile?.full_name || 'User'}</div>
              <div className="drawer-user-email">{user?.email}</div>
            </div>
          </div>
          <button className="drawer-logout" onClick={async () => { await signOut(); window.location.href = '/' }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4" />
              <polyline points="16 17 21 12 16 7" />
              <line x1="21" y1="12" x2="9" y2="12" />
            </svg>
            Sign Out
          </button>
        </div>
      </aside>
    </>
  )
}
