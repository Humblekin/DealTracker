import { Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import Navbar from './Navbar';
import AdminSidebar from './AdminSidebar';

export default function Layout() {
  const { profile } = useAuth();
  const location = useLocation();
  const isAdmin = profile?.role === 'admin';
  const isAdminRoute = location.pathname.startsWith('/admin');
  const showSidebar = isAdmin && isAdminRoute;

  if (showSidebar) {
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

  return (
    <>
      <Navbar />
      <main>
        <Outlet />
      </main>
    </>
  );
}
