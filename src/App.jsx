import { lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import { AuthProvider } from './contexts/AuthContext';
import { ThemeProvider } from './contexts/ThemeContext.jsx';
import Layout from './components/Layout';
import ProtectedRoute from './components/ProtectedRoute';

const Landing = lazy(() => import('./pages/Landing'));
const Login = lazy(() => import('./pages/Login'));
const Register = lazy(() => import('./pages/Register'));
import Dashboard from './pages/Dashboard';
const CreateDeal = lazy(() => import('./pages/CreateDeal'));
const DealDetails = lazy(() => import('./pages/DealDetails'));
const SharedDeal = lazy(() => import('./pages/SharedDeal'));
const LinkGuard = lazy(() => import('./pages/LinkGuard'));
const Transactions = lazy(() => import('./pages/Transactions'));
const AdminDashboard = lazy(() => import('./pages/AdminDashboard'));
const DeveloperAPI = lazy(() => import('./pages/DeveloperAPI'));

function PageLoader() {
  return (
    <div className="loading-screen" role="status" aria-live="polite" aria-busy="true">
      <div className="spinner"></div>
      <p>Loading...</p>
    </div>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <ThemeProvider>
        <AuthProvider>
          <Toaster
            position="top-right"
            toastOptions={{
              style: {
                background: 'var(--bg-card-solid)',
                color: 'var(--text-primary)',
                border: '1px solid var(--border-color)',
                borderRadius: '10px',
                fontSize: '0.88rem',
              },
              success: { iconTheme: { primary: '#10b981', secondary: '#fff' } },
              error: { iconTheme: { primary: '#ef4444', secondary: '#fff' } },
            }}
          />
          <Suspense fallback={<PageLoader />}>
            <Routes>
              <Route element={<Layout />}>
                <Route path="/" element={<Landing />} />
                <Route path="/login" element={<Login />} />
                <Route path="/register" element={<Register />} />
                <Route path="/deal/:shareToken" element={<LinkGuard />} />
                <Route path="/deal/:shareToken/view" element={<SharedDeal />} />
                <Route path="/developer" element={<DeveloperAPI />} />
                <Route path="/dashboard" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
                <Route path="/deals/create" element={<ProtectedRoute><CreateDeal /></ProtectedRoute>} />
                <Route path="/deals/:id" element={<ProtectedRoute><DealDetails /></ProtectedRoute>} />
                <Route path="/transactions" element={<ProtectedRoute><Transactions /></ProtectedRoute>} />
                <Route path="/admin" element={<ProtectedRoute allowedRoles={['admin']}><AdminDashboard /></ProtectedRoute>} />
                <Route path="/admin/:tab" element={<ProtectedRoute allowedRoles={['admin']}><AdminDashboard /></ProtectedRoute>} />
              </Route>
            </Routes>
          </Suspense>
        </AuthProvider>
      </ThemeProvider>
    </BrowserRouter>
  );
}
