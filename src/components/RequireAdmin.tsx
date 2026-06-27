import { Navigate, Outlet } from 'react-router-dom';
import { useAuth } from '../contexts/AuthProvider';

/**
 * Route guard for admin-only (write) pages. Redirects non-admins to /login.
 * UX guard only — the database is protected by RLS regardless of routing.
 * Used as a layout route: <Route element={<RequireAdmin />}> … </Route>.
 */
export function RequireAdmin() {
  const { isAdmin, loading } = useAuth();
  if (loading) return <div className="p-8 text-slate-400">Loading…</div>;
  if (!isAdmin) return <Navigate to="/login" replace />;
  return <Outlet />;
}
