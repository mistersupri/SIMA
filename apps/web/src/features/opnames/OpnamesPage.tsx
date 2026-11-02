import { useState } from 'react';
import { Link } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Plus } from 'lucide-react';
import { toast } from 'sonner';
import { OPNAME_STATUS_LABEL, opnameSchema } from '@sima/shared';
import { ApiError, api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { formatDate, todayIso } from '@/lib/format';
import { optionLabel, useOptions } from '@/hooks/use-options';
import { Button } from '@/components/ui/button';
import { Checkbox, Field, Input, Select, Textarea } from '@/components/ui/form';
import { CodeStamp } from '@/components/ui/misc';
import type { Column } from '@/components/ui/data-table';
import { Dialog } from '@/components/ui/dialog';
import { DocListPage } from '@/features/docs/DocListPage';
import { StatusTag, errMsg } from '@/features/docs/common';

interface Row { id: string; number: string; title: string; periodStart: string; periodEnd: string; status: string; total: number; checked: number; mine: boolean }

function CreateDialog({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const locations = useOptions('/locations');
  const units = useOptions('/organizational-units');
  const users = useQuery({ queryKey: ['opname-users'], queryFn: async () => (await api.get<{ id: string; name: string; email: string }[]>('/users?status=ACTIVE&limit=100&sortBy=name&sortOrder=asc')).data, retry: false });
  const { register, handleSubmit, setValue, watch, setError, formState: { errors, isSubmitting } } = useForm<Record<string, any>>({
    resolver: zodResolver(opnameSchema as never), defaultValues: { title: '', periodStart: todayIso(), periodEnd: todayIso(), locationId: '', unitId: '', notes: '', assigneeIds: [] },
  });
  const err = (k: string) => errors[k]?.message as string | undefined;
  const chosen: string[] = watch('assigneeIds') ?? [];
  const submit = handleSubmit(async (v) => {
    try { const r = await api.post('/stock-opnames', v); toast.success(r.message); await qc.invalidateQueries({ queryKey: ['opnames'] }); onClose(); }
    catch (e) { if (e instanceof ApiError && e.errors?.length) e.errors.forEach((fe) => setError(fe.field, { message: fe.message })); else toast.error(errMsg(e)); }
  });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} className="max-w-xl" title="Buat sesi stock opname" description="Daftar aset yang diperiksa diambil saat sesi dimulai, mencakup lokasi beserta sub-lokasinya."
      footer={<><Button variant="secondary" onClick={onClose}>Batal</Button><Button type="submit" form="opname-form" disabled={isSubmitting}>{isSubmitting ? 'Menyimpan…' : 'Buat sesi'}</Button></>}>
      <form id="opname-form" onSubmit={submit} noValidate className="grid gap-4 sm:grid-cols-2">
        <Field label="Judul" error={err('title')} required className="sm:col-span-2">{(p) => <Input {...p} {...register('title')} />}</Field>
        <Field label="Periode mulai" error={err('periodStart')} required>{(p) => <Input {...p} type="date" {...register('periodStart')} />}</Field>
        <Field label="Periode selesai" error={err('periodEnd')} required>{(p) => <Input {...p} type="date" {...register('periodEnd')} />}</Field>
        <Field label="Lokasi diperiksa" error={err('locationId')}>{(p) => (<Select {...p} {...register('locationId')}><option value="">Semua lokasi</option>{locations.data?.map((o) => <option key={o.id} value={o.id}>{optionLabel(o)}</option>)}</Select>)}</Field>
        <Field label="Unit kerja" error={err('unitId')}>{(p) => (<Select {...p} {...register('unitId')}><option value="">Semua unit</option>{units.data?.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</Select>)}</Field>
        <fieldset className="sm:col-span-2">
          <legend className="mb-1 text-sm font-medium">Petugas pemeriksa <span className="text-danger-ink" aria-hidden>*</span></legend>
          {users.isPending && <p className="text-sm text-muted">Memuat pengguna…</p>}
          {users.error && <p className="text-sm text-danger-ink">Daftar pengguna tidak dapat dimuat. Anda memerlukan izin melihat pengguna untuk menetapkan petugas.</p>}
          <div className="grid max-h-40 gap-0.5 overflow-y-auto sm:grid-cols-2">
            {users.data?.map((u) => <Checkbox key={u.id} label={u.name} checked={chosen.includes(u.id)} onChange={(e) => setValue('assigneeIds', e.target.checked ? [...chosen, u.id] : chosen.filter((x) => x !== u.id), { shouldValidate: true })} />)}
          </div>
          {err('assigneeIds') && <p role="alert" className="mt-1 text-sm text-danger-ink">{err('assigneeIds')}</p>}
        </fieldset>
        <Field label="Catatan" error={err('notes')} className="sm:col-span-2">{(p) => <Textarea {...p} rows={2} {...register('notes')} />}</Field>
      </form>
    </Dialog>
  );
}

export function OpnamesPage() {
  const { can } = useAuth();
  const [creating, setCreating] = useState(false);
  const columns: Column<Row>[] = [
    { key: 'number', header: 'Nomor', sortable: true, cell: (r) => <Link to={`/opname/${r.id}`} className="hover:underline"><CodeStamp>{r.number}</CodeStamp></Link> },
    { key: 'title', header: 'Judul', cell: (r) => (<div><div className="font-medium">{r.title}</div><div className="text-xs text-muted">{formatDate(r.periodStart)} - {formatDate(r.periodEnd)}</div></div>) },
    { key: 'progress', header: 'Progres', cell: (r) => r.status === 'DRAFT' ? <span className="text-muted">-</span> : `${r.checked} / ${r.total}` },
    { key: 'status', header: 'Status', sortable: true, cell: (r) => <StatusTag value={r.status} labels={OPNAME_STATUS_LABEL} /> },
    { key: 'actions', header: 'Aksi', className: 'text-right', cell: (r) => r.status === 'IN_PROGRESS' && r.mine && can('stock_opnames.scan') ? <Button asChild size="sm"><Link to={`/opname/${r.id}/periksa`}>Periksa</Link></Button> : null },
  ];
  return (
    <>
      <DocListPage<Row> title="Stock Opname" description="Pemeriksaan fisik aset dengan pemindaian QR. Temuan tidak sesuai baru mengubah data aset setelah diverifikasi." queryKey="opnames" path="/stock-opnames"
        statusLabels={OPNAME_STATUS_LABEL} columns={columns} searchPlaceholder="Cari nomor atau judul" emptyTitle="Belum ada sesi stock opname"
        extraActions={can('stock_opnames.create') ? <Button onClick={() => setCreating(true)}><Plus className="size-4" aria-hidden /> Buat sesi</Button> : undefined} />
      {creating && <CreateDialog onClose={() => setCreating(false)} />}
    </>
  );
}
