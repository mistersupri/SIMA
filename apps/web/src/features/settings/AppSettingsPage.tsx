import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import { organizationSchema, type OrganizationInput } from '@sima/shared';
import { ApiError, api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Field, Input, Textarea } from '@/components/ui/form';
import { Card, ErrorState, PageHeader, Spinner } from '@/components/ui/misc';

interface Organization { code: string; name: string; address: string | null; phone: string | null; email: string | null }

export function AppSettingsPage() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['settings', 'organization'], queryFn: async () => (await api.get<Organization>('/settings/organization')).data });
  const { register, handleSubmit, setError, formState: { errors, isSubmitting, isDirty } } = useForm<OrganizationInput>({
    resolver: zodResolver(organizationSchema) as never,
    values: q.data ? { name: q.data.name, address: q.data.address ?? '', phone: q.data.phone ?? '', email: q.data.email ?? '' } : undefined,
  });

  const submit = handleSubmit(async (values) => {
    try {
      await api.patch('/settings/organization', values);
      await Promise.all([qc.invalidateQueries({ queryKey: ['settings', 'organization'] }), qc.invalidateQueries({ queryKey: ['app-info'] })]);
      toast.success('Identitas instansi disimpan');
    } catch (e) {
      if (e instanceof ApiError && e.errors?.length) e.errors.forEach((f) => setError(f.field as keyof OrganizationInput, { message: f.message }));
      else toast.error(e instanceof ApiError ? e.message : 'Terjadi kesalahan');
    }
  });

  return (
    <div className="max-w-2xl">
      <PageHeader title="Pengaturan Aplikasi" description="Identitas instansi tampil di halaman login, menu, dan kepala laporan yang diekspor." />
      {q.isPending ? <Spinner /> : q.isError ? <ErrorState message={q.error instanceof ApiError ? q.error.message : 'Gagal memuat pengaturan'} onRetry={() => q.refetch()} /> : (
        <Card className="p-5">
          <form onSubmit={submit} noValidate className="flex flex-col gap-4">
            <p className="text-sm text-muted">Kode instansi: <span className="font-mono text-ink">{q.data.code}</span> (tidak dapat diubah karena menjadi bagian kode inventaris)</p>
            <Field label="Nama instansi" error={errors.name?.message} required>{(p) => <Input {...p} {...register('name')} />}</Field>
            <Field label="Alamat" error={errors.address?.message}>{(p) => <Textarea {...p} rows={3} {...register('address')} />}</Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Telepon" error={errors.phone?.message}>{(p) => <Input {...p} type="tel" {...register('phone')} />}</Field>
              <Field label="Email" error={errors.email?.message}>{(p) => <Input {...p} type="email" {...register('email')} />}</Field>
            </div>
            <div><Button type="submit" disabled={isSubmitting || !isDirty}>{isSubmitting ? 'Menyimpan…' : 'Simpan'}</Button></div>
          </form>
        </Card>
      )}
    </div>
  );
}
