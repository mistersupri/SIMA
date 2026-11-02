import { useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { loginSchema, type LoginInput } from '@sima/shared';
import { ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Button } from '@/components/ui/button';
import { useOrganizationName } from '@/lib/app-info';
import { Field, Input } from '@/components/ui/form';

export function LoginPage() {
  const { user, login } = useAuth();
  const org = useOrganizationName();
  const navigate = useNavigate();
  const from = (useLocation().state as { from?: string } | null)?.from ?? '/';
  const [serverError, setServerError] = useState<string | null>(null);
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<LoginInput>({ resolver: zodResolver(loginSchema) });

  if (user) return <Navigate to={user.mustChangePassword ? '/ganti-password' : from} replace />;

  const onSubmit = handleSubmit(async (values) => {
    setServerError(null);
    try {
      const u = await login(values);
      navigate(u.mustChangePassword ? '/ganti-password' : from, { replace: true });
    } catch (e) {
      setServerError(e instanceof ApiError ? e.message : 'Terjadi kesalahan');
    }
  });

  return (
    <main className="grid min-h-dvh place-items-center px-4 py-10">
      <div className="w-full max-w-sm">
        <h1 className="text-2xl font-semibold text-navy">SIMA</h1>
        <p className="mt-1 text-sm text-muted">Sistem Informasi Manajemen Inventaris Barang</p>
        {org && <p className="mt-0.5 text-sm font-medium text-ink">{org}</p>}

        <form onSubmit={onSubmit} noValidate className="mt-6 flex flex-col gap-4 rounded-card border border-line bg-surface p-5">
          <h2 className="text-base font-semibold">Masuk ke akun Anda</h2>
          {serverError && (
            <p role="alert" className="rounded-control border border-danger/30 bg-danger-wash px-3 py-2 text-sm text-danger-ink">
              {serverError}
            </p>
          )}
          <Field label="Email" error={errors.email?.message} required>
            {(p) => <Input {...p} type="email" autoComplete="username" autoFocus {...register('email')} />}
          </Field>
          <Field label="Password" error={errors.password?.message} required>
            {(p) => <Input {...p} type="password" autoComplete="current-password" {...register('password')} />}
          </Field>
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting ? 'Memeriksa…' : 'Masuk'}
          </Button>
        </form>
        <p className="mt-4 text-sm text-muted">Lupa password? Hubungi administrator untuk mengatur ulang.</p>
      </div>
    </main>
  );
}
