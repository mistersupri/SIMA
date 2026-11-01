import { useState } from 'react';
import { useMutation, useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Plus, Search } from 'lucide-react';
import { toast } from 'sonner';
import { adminResetPasswordSchema, createUserSchema, updateUserSchema, type UserListItem } from '@sima/shared';
import { ApiError, api, buildQuery } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useListState } from '@/hooks/use-list-state';
import { Button } from '@/components/ui/button';
import { Checkbox, Field, Input, Select } from '@/components/ui/form';
import { Badge, PageHeader } from '@/components/ui/misc';
import { DataTable, type Column } from '@/components/ui/data-table';
import { Dialog } from '@/components/ui/dialog';
import { ConfirmDialog } from '@/components/ui/confirm';
import { RowMenu } from '@/components/ui/row-menu';

interface Opt { id: string; name: string; code?: string }
const useOptions = (path: string) =>
  useQuery({ queryKey: ['options', path], queryFn: async () => (await api.get<Opt[]>(path)).data, staleTime: 60_000 });

const errMsg = (e: unknown) => (e instanceof ApiError ? e.message : 'Terjadi kesalahan');

function RoleChecklist({ options, value, onChange, error }: { options: Opt[]; value: string[]; onChange: (v: string[]) => void; error?: string }) {
  return (
    <fieldset className="flex flex-col gap-0.5">
      <legend className="mb-1 text-sm font-medium">Role <span className="text-danger-ink" aria-hidden>*</span></legend>
      {options.map((r) => (
        <Checkbox key={r.id} label={r.name} checked={value.includes(r.id)} onChange={(e) => onChange(e.target.checked ? [...value, r.id] : value.filter((x) => x !== r.id))} />
      ))}
      {error && <p role="alert" className="text-sm text-danger-ink">{error}</p>}
    </fieldset>
  );
}

function UserFormDialog({ user, onClose }: { user: UserListItem | 'new' | null; onClose: () => void }) {
  const qc = useQueryClient();
  const editing = user && user !== 'new' ? user : null;
  const units = useOptions('/organizational-units?limit=100&isActive=true');
  const roles = useOptions('/roles/options');
  const form = useForm({
    resolver: zodResolver(editing ? updateUserSchema : createUserSchema) as never,
    values: editing ? { name: editing.name, email: editing.email, unitId: editing.unitId ?? '' } : { name: '', email: '', password: '', unitId: '', roleIds: [] as string[] },
  });
  const { register, handleSubmit, setError, setValue, watch, formState: { errors, isSubmitting } } = form as unknown as ReturnType<typeof useForm<Record<string, any>>>;
  const fieldErr = (k: string) => errors[k]?.message as string | undefined;

  const save = handleSubmit(async (values) => {
    try {
      if (editing) await api.patch(`/users/${editing.id}`, values);
      else await api.post('/users', values);
      toast.success(editing ? 'Pengguna diperbarui' : 'Pengguna dibuat');
      await qc.invalidateQueries({ queryKey: ['users'] });
      onClose();
    } catch (e) {
      if (e instanceof ApiError && e.errors?.length) e.errors.forEach((fe) => setError(fe.field, { message: fe.message }));
      else toast.error(errMsg(e));
    }
  });

  return (
    <Dialog
      open={!!user}
      onOpenChange={(o) => !o && onClose()}
      title={editing ? 'Ubah pengguna' : 'Tambah pengguna'}
      description={editing ? undefined : 'Pengguna wajib mengganti password sementara saat login pertama.'}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Batal</Button>
          <Button type="submit" form="user-form" disabled={isSubmitting}>{isSubmitting ? 'Menyimpan…' : 'Simpan'}</Button>
        </>
      }
    >
      <form id="user-form" onSubmit={save} noValidate className="flex flex-col gap-4">
        <Field label="Nama lengkap" error={fieldErr('name')} required>{(p) => <Input {...p} {...register('name')} />}</Field>
        <Field label="Email" error={fieldErr('email')} required>{(p) => <Input {...p} type="email" autoComplete="off" {...register('email')} />}</Field>
        {!editing && (
          <Field label="Password sementara" hint="Minimal 10 karakter, memuat huruf besar, huruf kecil, dan angka." error={fieldErr('password')} required>
            {(p) => <Input {...p} type="password" autoComplete="new-password" {...register('password')} />}
          </Field>
        )}
        <Field label="Unit kerja" error={fieldErr('unitId')}>
          {(p) => (
            <Select {...p} {...register('unitId')}>
              <option value="">Tidak ditentukan</option>
              {units.data?.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </Select>
          )}
        </Field>
        {!editing && roles.data && (
          <RoleChecklist options={roles.data} value={watch('roleIds') ?? []} onChange={(v) => setValue('roleIds', v, { shouldValidate: true })} error={fieldErr('roleIds')} />
        )}
      </form>
    </Dialog>
  );
}

function RolesDialog({ user, onClose }: { user: UserListItem | null; onClose: () => void }) {
  const qc = useQueryClient();
  const roles = useOptions('/roles/options');
  const [draft, setDraft] = useState<string[] | null>(null);
  const value = draft ?? user?.roles.map((r) => r.id) ?? [];
  const mutation = useMutation({
    mutationFn: () => api.put(`/users/${user!.id}/roles`, { roleIds: value }),
    onSuccess: async () => { toast.success('Role pengguna diperbarui'); await qc.invalidateQueries({ queryKey: ['users'] }); onClose(); },
    onError: (e) => toast.error(errMsg(e)),
  });
  return (
    <Dialog
      open={!!user}
      onOpenChange={(o) => { if (!o) { setDraft(null); onClose(); } }}
      title={`Atur role: ${user?.name ?? ''}`}
      description="Pengguna dapat memiliki lebih dari satu role. Perubahan berlaku pada permintaan berikutnya."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Batal</Button>
          <Button disabled={mutation.isPending || value.length === 0} onClick={() => mutation.mutate()}>{mutation.isPending ? 'Menyimpan…' : 'Simpan role'}</Button>
        </>
      }
    >
      {roles.data && <RoleChecklist options={roles.data} value={value} onChange={setDraft} error={value.length === 0 ? 'Pilih minimal satu role' : undefined} />}
    </Dialog>
  );
}

function ResetPasswordDialog({ user, onClose }: { user: UserListItem | null; onClose: () => void }) {
  const { register, handleSubmit, reset, setError, formState: { errors, isSubmitting } } = useForm({ resolver: zodResolver(adminResetPasswordSchema) });
  const submit = handleSubmit(async (v) => {
    try {
      await api.post(`/users/${user!.id}/reset-password`, v);
      toast.success('Password diatur ulang. Pengguna wajib menggantinya saat login.');
      reset();
      onClose();
    } catch (e) {
      if (e instanceof ApiError && e.errors?.length) e.errors.forEach((fe) => setError('newPassword', { message: fe.message }));
      else toast.error(errMsg(e));
    }
  });
  return (
    <Dialog
      open={!!user}
      onOpenChange={(o) => !o && onClose()}
      title={`Atur ulang password: ${user?.name ?? ''}`}
      description="Semua sesi aktif pengguna akan dicabut."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Batal</Button>
          <Button type="submit" form="reset-form" disabled={isSubmitting}>{isSubmitting ? 'Menyimpan…' : 'Atur ulang'}</Button>
        </>
      }
    >
      <form id="reset-form" onSubmit={submit} noValidate>
        <Field label="Password sementara baru" hint="Minimal 10 karakter, memuat huruf besar, huruf kecil, dan angka." error={errors.newPassword?.message} required>
          {(p) => <Input {...p} type="password" autoComplete="new-password" {...register('newPassword')} />}
        </Field>
      </form>
    </Dialog>
  );
}

export function UsersPage() {
  const { can, user: me } = useAuth();
  const qc = useQueryClient();
  const list = useListState({ sortBy: 'name' });
  const roles = useOptions('/roles/options');
  const [form, setForm] = useState<UserListItem | 'new' | null>(null);
  const [rolesFor, setRolesFor] = useState<UserListItem | null>(null);
  const [resetFor, setResetFor] = useState<UserListItem | null>(null);
  const [statusFor, setStatusFor] = useState<UserListItem | null>(null);
  const s = list.state;

  const query = useQuery({
    queryKey: ['users', s],
    queryFn: ({ signal }) => api.get<UserListItem[]>(`/users${buildQuery({ page: s.page, limit: s.limit, search: s.search, sortBy: s.sortBy, sortOrder: s.sortOrder, ...s.filters })}`, signal),
    placeholderData: keepPreviousData,
  });
  const manage = can('users.manage');

  const columns: Column<UserListItem>[] = [
    { key: 'name', header: 'Nama', sortable: true, cell: (u) => (<div><div className="font-medium">{u.name}</div><div className="text-xs text-muted">{u.email}</div></div>) },
    { key: 'unit', header: 'Unit kerja', cell: (u) => u.unit?.name ?? <span className="text-muted">-</span> },
    { key: 'roles', header: 'Role', cell: (u) => <div className="flex flex-wrap gap-1">{u.roles.map((r) => <Badge key={r.id} tone="info">{r.name}</Badge>)}</div> },
    { key: 'status', header: 'Status', sortable: true, cell: (u) => <Badge tone={u.status === 'ACTIVE' ? 'success' : 'neutral'}>{u.status === 'ACTIVE' ? 'Aktif' : 'Nonaktif'}</Badge> },
    { key: 'lastLoginAt', header: 'Login terakhir', sortable: true, cell: (u) => (u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' }) : <span className="text-muted">Belum pernah</span>) },
    ...(manage ? [{
      key: 'actions', header: 'Aksi', className: 'w-16 text-right',
      cell: (u: UserListItem) => (
        <RowMenu label={`Aksi untuk ${u.name}`} items={[
          { label: 'Ubah data', onSelect: () => setForm(u) },
          { label: 'Atur role', onSelect: () => setRolesFor(u) },
          { label: 'Atur ulang password', onSelect: () => setResetFor(u) },
          { label: u.status === 'ACTIVE' ? 'Nonaktifkan' : 'Aktifkan', danger: u.status === 'ACTIVE', hidden: u.id === me?.id, onSelect: () => setStatusFor(u) },
        ]} />
      ),
    }] : []),
  ];

  return (
    <>
      <PageHeader
        title="Pengguna"
        description="Kelola akun, role, dan status pengguna aplikasi."
        actions={manage ? <Button onClick={() => setForm('new')}><Plus className="size-4" aria-hidden /> Tambah pengguna</Button> : undefined}
      />
      <div className="mb-3 flex flex-wrap gap-2">
        <div className="relative min-w-56 flex-1 sm:max-w-xs">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" aria-hidden />
          <Input aria-label="Cari pengguna" placeholder="Cari nama atau email" className="pl-9" value={list.searchInput} onChange={(e) => list.setSearchInput(e.target.value)} />
        </div>
        <Select aria-label="Filter status" className="w-auto" value={s.filters.status ?? ''} onChange={(e) => list.setFilter('status', e.target.value)}>
          <option value="">Semua status</option><option value="ACTIVE">Aktif</option><option value="INACTIVE">Nonaktif</option>
        </Select>
        <Select aria-label="Filter role" className="w-auto" value={s.filters.roleId ?? ''} onChange={(e) => list.setFilter('roleId', e.target.value)}>
          <option value="">Semua role</option>
          {roles.data?.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
        </Select>
      </div>
      <DataTable
        caption="Daftar pengguna"
        columns={columns}
        rows={query.data?.data}
        rowKey={(u) => u.id}
        loading={query.isFetching}
        error={query.error ? errMsg(query.error) : null}
        onRetry={() => void query.refetch()}
        meta={query.data?.meta}
        sortBy={s.sortBy}
        sortOrder={s.sortOrder}
        onSort={list.toggleSort}
        onPage={list.setPage}
        onLimit={list.setLimit}
        empty={{ title: 'Tidak ada pengguna ditemukan', description: s.search || Object.values(s.filters).some(Boolean) ? 'Ubah kata kunci atau filter pencarian.' : 'Tambahkan pengguna pertama.' }}
      />

      <UserFormDialog user={form} onClose={() => setForm(null)} />
      <RolesDialog key={rolesFor?.id} user={rolesFor} onClose={() => setRolesFor(null)} />
      <ResetPasswordDialog key={resetFor?.id} user={resetFor} onClose={() => setResetFor(null)} />
      <ConfirmDialog
        open={!!statusFor}
        onOpenChange={(o) => !o && setStatusFor(null)}
        title={statusFor?.status === 'ACTIVE' ? 'Nonaktifkan pengguna?' : 'Aktifkan pengguna?'}
        description={statusFor?.status === 'ACTIVE' ? `${statusFor?.name} tidak dapat login dan semua sesinya dicabut.` : `${statusFor?.name} dapat login kembali.`}
        confirmLabel={statusFor?.status === 'ACTIVE' ? 'Nonaktifkan' : 'Aktifkan'}
        danger={statusFor?.status === 'ACTIVE'}
        onConfirm={async () => {
          try {
            await api.patch(`/users/${statusFor!.id}/status`, { status: statusFor!.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE' });
            toast.success('Status pengguna diperbarui');
            await qc.invalidateQueries({ queryKey: ['users'] });
          } catch (e) { toast.error(errMsg(e)); throw e; }
        }}
      />
    </>
  );
}
