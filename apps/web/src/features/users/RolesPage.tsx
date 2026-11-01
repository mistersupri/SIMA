import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Plus } from 'lucide-react';
import { toast } from 'sonner';
import { PERMISSION_MODULES, ROLE_CODES, createRoleSchema } from '@sima/shared';
import { ApiError, api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Checkbox, Field, Input, Textarea } from '@/components/ui/form';
import { Badge, Card, ErrorState, PageHeader, Spinner } from '@/components/ui/misc';
import { Dialog } from '@/components/ui/dialog';
import { ConfirmDialog } from '@/components/ui/confirm';

interface RoleRow { id: string; code: string; name: string; description: string | null; isSystem: boolean; userCount: number; permissions: string[] }
interface PermRow { id: string; code: string; module: string; description: string | null }
const errMsg = (e: unknown) => (e instanceof ApiError ? e.message : 'Terjadi kesalahan');

function CreateRoleDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const { register, handleSubmit, reset, setError, formState: { errors, isSubmitting } } = useForm({ resolver: zodResolver(createRoleSchema) as never });
  const submit = handleSubmit(async (v) => {
    try {
      await api.post('/roles', v);
      toast.success('Role dibuat. Atur permission-nya di panel kanan.');
      await qc.invalidateQueries({ queryKey: ['roles'] });
      reset();
      onClose();
    } catch (e) {
      if (e instanceof ApiError && e.errors?.length) e.errors.forEach((fe) => setError(fe.field as 'code', { message: fe.message }));
      else toast.error(errMsg(e));
    }
  });
  const err = errors as Record<string, { message?: string }>;
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()} title="Tambah role" footer={<><Button variant="secondary" onClick={onClose}>Batal</Button><Button type="submit" form="role-form" disabled={isSubmitting}>Simpan</Button></>}>
      <form id="role-form" onSubmit={submit} noValidate className="flex flex-col gap-4">
        <Field label="Kode role" hint="Huruf kapital dan underscore, contoh: KEPALA_GUDANG." error={err.code?.message} required>{(p) => <Input {...p} {...register('code')} />}</Field>
        <Field label="Nama role" error={err.name?.message} required>{(p) => <Input {...p} {...register('name')} />}</Field>
        <Field label="Deskripsi" error={err.description?.message}>{(p) => <Textarea {...p} {...register('description')} />}</Field>
      </form>
    </Dialog>
  );
}

export function RolesPage() {
  const { can } = useAuth();
  const qc = useQueryClient();
  const roles = useQuery({ queryKey: ['roles'], queryFn: async () => (await api.get<RoleRow[]>('/roles')).data });
  const perms = useQuery({ queryKey: ['permissions'], queryFn: async () => (await api.get<PermRow[]>('/permissions')).data, staleTime: 300_000 });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Set<string> | null>(null);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const selected = roles.data?.find((r) => r.id === (selectedId ?? roles.data[0]?.id));
  const current = draft ?? new Set(selected?.permissions);
  const dirty = !!draft && selected ? draft.size !== selected.permissions.length || selected.permissions.some((p) => !draft.has(p)) : false;
  const readOnly = !can('roles.manage') || selected?.code === ROLE_CODES.SUPER_ADMIN;

  const grouped = useMemo(() => {
    const m = new Map<string, PermRow[]>();
    for (const p of perms.data ?? []) m.set(p.module, [...(m.get(p.module) ?? []), p]);
    const order = Object.keys(PERMISSION_MODULES);
    return [...m.entries()].sort(([a], [b]) => order.indexOf(a) - order.indexOf(b));
  }, [perms.data]);

  const save = useMutation({
    mutationFn: () => api.put(`/roles/${selected!.id}/permissions`, { permissions: [...current] }),
    onSuccess: async () => { toast.success('Permission role disimpan'); setDraft(null); await qc.invalidateQueries({ queryKey: ['roles'] }); },
    onError: (e) => toast.error(errMsg(e)),
  });

  if (roles.isPending || perms.isPending) return <div className="py-16 text-center"><Spinner label="Memuat role…" /></div>;
  if (roles.error || perms.error) return <ErrorState message={errMsg(roles.error ?? perms.error)} onRetry={() => { void roles.refetch(); void perms.refetch(); }} />;

  const toggle = (code: string, on: boolean) => { const next = new Set(current); if (on) next.add(code); else next.delete(code); setDraft(next); };

  return (
    <>
      <PageHeader
        title="Role dan Permission"
        description="Atur hak akses granular per role. Perubahan berlaku segera untuk semua pengguna dengan role tersebut."
        actions={can('roles.manage') ? <Button onClick={() => setCreating(true)}><Plus className="size-4" aria-hidden /> Tambah role</Button> : undefined}
      />
      <div className="grid gap-4 lg:grid-cols-[18rem_1fr]">
        <Card className="self-start">
          <ul aria-label="Daftar role">
            {roles.data.map((r) => (
              <li key={r.id} className="border-b border-line last:border-0">
                <button
                  type="button"
                  aria-pressed={r.id === selected?.id}
                  onClick={() => { setSelectedId(r.id); setDraft(null); }}
                  className={cn('flex min-h-11 w-full flex-col items-start px-4 py-2.5 text-left transition-colors duration-150 hover:bg-canvas', r.id === selected?.id && 'bg-blue-50')}
                >
                  <span className="text-sm font-medium">{r.name}</span>
                  <span className="text-xs text-muted">{r.userCount} pengguna · {r.permissions.length} permission{r.isSystem ? ' · bawaan' : ''}</span>
                </button>
              </li>
            ))}
          </ul>
        </Card>

        {selected && (
          <Card>
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3">
              <div>
                <h2 className="font-semibold">{selected.name}</h2>
                <p className="text-sm text-muted">{selected.description ?? 'Tanpa deskripsi'}</p>
              </div>
              <div className="flex gap-2">
                {!selected.isSystem && can('roles.manage') && <Button variant="secondary" onClick={() => setDeleting(true)}>Hapus role</Button>}
                {!readOnly && <Button disabled={!dirty || save.isPending} onClick={() => save.mutate()}>{save.isPending ? 'Menyimpan…' : 'Simpan perubahan'}</Button>}
              </div>
            </div>
            {selected.code === ROLE_CODES.SUPER_ADMIN && <p className="border-b border-line bg-warning-wash px-4 py-2 text-sm text-warning-ink">Super Admin selalu memiliki seluruh permission dan tidak dapat diubah.</p>}
            <div className="grid gap-x-6 gap-y-5 p-4 md:grid-cols-2">
              {grouped.map(([module, rows]) => (
                <fieldset key={module}>
                  <legend className="mb-1 flex items-center gap-2 text-sm font-semibold text-navy">
                    {PERMISSION_MODULES[module as keyof typeof PERMISSION_MODULES]?.label ?? module}
                    <Badge>{rows.filter((r) => current.has(r.code)).length}/{rows.length}</Badge>
                  </legend>
                  {rows.map((p) => (
                    <Checkbox key={p.code} disabled={readOnly} checked={current.has(p.code)} onChange={(e) => toggle(p.code, e.target.checked)} label={<span>{p.description ?? p.code} <span className="code-stamp ml-1">{p.code}</span></span>} />
                  ))}
                </fieldset>
              ))}
            </div>
          </Card>
        )}
      </div>

      <CreateRoleDialog open={creating} onClose={() => setCreating(false)} />
      <ConfirmDialog
        open={deleting}
        onOpenChange={setDeleting}
        title="Hapus role?"
        description={`Role "${selected?.name}" akan dihapus permanen. Role yang masih dipakai pengguna tidak dapat dihapus.`}
        confirmLabel="Hapus role"
        danger
        onConfirm={async () => {
          try { await api.delete(`/roles/${selected!.id}`); toast.success('Role dihapus'); setSelectedId(null); await qc.invalidateQueries({ queryKey: ['roles'] }); }
          catch (e) { toast.error(errMsg(e)); throw e; }
        }}
      />
    </>
  );
}
