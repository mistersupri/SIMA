import type { ReactNode } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router';
import { ShieldAlert } from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { ErrorState, Spinner } from '@/components/ui/misc';
import { NAV } from '@/layouts/nav';

export function RequireAuth() {
  const { user, loading, error, refresh } = useAuth();
  const { pathname } = useLocation();
  if (loading) return <div className="grid min-h-dvh place-items-center"><Spinner label="Memuat sesi…" /></div>;
  if (error) return <div className="grid min-h-dvh place-items-center"><ErrorState message={error.message} onRetry={() => void refresh()} /></div>;
  if (!user) return <Navigate to="/login" replace state={{ from: pathname }} />;
  if (user.mustChangePassword && pathname !== '/ganti-password') return <Navigate to="/ganti-password" replace />;
  return <Outlet />;
}

export function RequirePermission({ permission, children }: { permission: string; children: ReactNode }) {
  const { can } = useAuth();
  if (!can(permission)) {
    return (
      <div role="alert" className="mx-auto flex max-w-md flex-col items-center gap-2 py-20 text-center">
        <ShieldAlert className="size-8 text-warning-ink" aria-hidden />
        <h1 className="text-lg font-semibold">Anda tidak memiliki akses</h1>
        <p className="text-sm text-muted">Halaman ini memerlukan izin yang belum diberikan ke akun Anda. Hubungi administrator bila perlu.</p>
      </div>
    );
  }
  return <>{children}</>;
}

/** Arahkan "/" ke halaman pertama yang boleh dibuka pengguna. */
export function HomeRedirect() {
  const { can } = useAuth();
  const first = NAV.flatMap((g) => g.items).find((i) => i.to !== '/' && can(i.permission));
  if (!first) {
    return (
      <div role="alert" className="mx-auto max-w-md py-20 text-center">
        <h1 className="text-lg font-semibold">Akun belum memiliki akses ke halaman apa pun</h1>
        <p className="mt-1 text-sm text-muted">Minta administrator menambahkan role untuk akun Anda.</p>
      </div>
    );
  }
  return <Navigate to={first.to} replace />;
}
