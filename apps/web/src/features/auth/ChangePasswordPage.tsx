import { useState } from 'react';
import { useNavigate } from 'react-router';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import { changePasswordSchema, type ChangePasswordInput } from '@sima/shared';
import { ApiError, api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/form';

export function ChangePasswordPage() {
  const { user, refresh, logout } = useAuth();
  const navigate = useNavigate();
  const forced = !!user?.mustChangePassword;
  const [serverError, setServerError] = useState<string | null>(null);
  const { register, handleSubmit, setError, formState: { errors, isSubmitting } } = useForm<ChangePasswordInput>({ resolver: zodResolver(changePasswordSchema) });

  const onSubmit = handleSubmit(async (values) => {
    setServerError(null);
    try {
      await api.post('/auth/change-password', values);
      await refresh();
      toast.success('Password berhasil diganti');
      navigate('/', { replace: true });
    } catch (e) {
      if (e instanceof ApiError && e.errors?.length) {
        for (const fe of e.errors) setError(fe.field as keyof ChangePasswordInput, { message: fe.message });
      } else setServerError(e instanceof ApiError ? e.message : 'Terjadi kesalahan');
    }
  });

  return (
    <main className="mx-auto w-full max-w-sm px-4 py-10">
      <h1 className="text-xl font-semibold text-navy">Ganti password</h1>
      {forced && (
        <p className="mt-2 rounded-control border border-warning/40 bg-warning-wash px-3 py-2 text-sm text-warning-ink">
          Demi keamanan, ganti password sementara Anda sebelum melanjutkan.
        </p>
      )}
      <form onSubmit={onSubmit} noValidate className="mt-5 flex flex-col gap-4 rounded-card border border-line bg-surface p-5">
        {serverError && <p role="alert" className="text-sm text-danger-ink">{serverError}</p>}
        <Field label="Password saat ini" error={errors.currentPassword?.message} required>
          {(p) => <Input {...p} type="password" autoComplete="current-password" {...register('currentPassword')} />}
        </Field>
        <Field label="Password baru" hint="Minimal 10 karakter, memuat huruf besar, huruf kecil, dan angka." error={errors.newPassword?.message} required>
          {(p) => <Input {...p} type="password" autoComplete="new-password" {...register('newPassword')} />}
        </Field>
        <Field label="Ulangi password baru" error={errors.confirmPassword?.message} required>
          {(p) => <Input {...p} type="password" autoComplete="new-password" {...register('confirmPassword')} />}
        </Field>
        <div className="flex gap-2">
          <Button type="submit" disabled={isSubmitting}>{isSubmitting ? 'Menyimpan…' : 'Simpan password'}</Button>
          {forced ? (
            <Button variant="ghost" onClick={async () => { await logout(); navigate('/login', { replace: true }); }}>Keluar</Button>
          ) : (
            <Button variant="ghost" onClick={() => navigate(-1)}>Batal</Button>
          )}
        </div>
      </form>
    </main>
  );
}
