import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Plus, Printer, Search } from 'lucide-react';
import { toast } from 'sonner';
import { ASSET_CONDITIONS, ASSET_CONDITION_LABEL, ASSET_STATUSES, ASSET_STATUS_LABEL, registerAssetsSchema } from '@sima/shared';
import { ApiError, api, buildQuery } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { todayIso } from '@/lib/format';
import { useListState } from '@/hooks/use-list-state';
import { optionLabel, useOptions } from '@/hooks/use-options';
import { Button } from '@/components/ui/button';
import { Checkbox, Field, Input, Select, Textarea } from '@/components/ui/form';
import { CodeStamp, PageHeader } from '@/components/ui/misc';
import { DataTable, type Column } from '@/components/ui/data-table';
import { Dialog } from '@/components/ui/dialog';
import { ConditionBadge, StatusBadge } from './labels';

export interface AssetRow {
  id: string; code: string; serialNumber: string | null; condition: keyof typeof ASSET_CONDITION_LABEL; status: keyof typeof ASSET_STATUS_LABEL; acquisitionYear: number;
  item: { id: string; name: string; category: { name: string } }; unit: { id: string; name: string }; location: { id: string; name: string }; person: { name: string } | null;
}
const errMsg = (e: unknown) => (e instanceof ApiError ? e.message : 'Terjadi kesalahan');

function RegisterDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const items = useOptions('/items', { type: 'ASSET' });
  const units = useOptions('/organizational-units');
  const locations = useOptions('/locations');
  const persons = useOptions('/persons');
  const funding = useOptions('/funding-sources');
  const vendors = useOptions('/vendors');
  const year = new Date().getFullYear();
  const { register, handleSubmit, setError, watch, getValues, formState: { errors, isSubmitting } } = useForm<Record<string, any>>({
    resolver: zodResolver(registerAssetsSchema as never),
    defaultValues: { itemId: '', quantity: 1, serialText: '', acquisitionDate: todayIso(), acquisitionYear: year, fundingSourceId: '', vendorId: '', acquisitionCost: 0, condition: 'GOOD', unitId: '', locationId: '', personId: '', notes: '' },
  });
  const err = (k: string) => errors[k]?.message as string | undefined;
  const qty = Number(watch('quantity')) || 1;

  const submit = handleSubmit(async (values) => {
    // `values` adalah hasil parsing Zod: field di luar skema (serialText) sudah dibuang, jadi baca dari form.
    const serials = String(getValues('serialText') ?? '').split('\n').map((x) => x.trim());
    const payload = { ...values, serialNumbers: serials.some(Boolean) ? serials : [] };
    try {
      const res = await api.post<{ id: string }[]>('/assets', payload);
      toast.success(res.message);
      await qc.invalidateQueries({ queryKey: ['assets'] });
      onClose();
      if (res.data.length === 1) navigate(`/aset/${res.data[0]!.id}`);
    } catch (e) {
      if (e instanceof ApiError && e.errors?.length) e.errors.forEach((fe) => setError(fe.field === 'serialNumbers' ? 'serialText' : fe.field, { message: fe.message }));
      else toast.error(errMsg(e));
    }
  });

  return (
    <Dialog
      open={open} onOpenChange={(o) => !o && onClose()} className="max-w-2xl"
      title="Registrasi aset" description="Setiap unit mendapat kode inventaris dan QR Code sendiri."
      footer={<><Button variant="secondary" onClick={onClose}>Batal</Button><Button type="submit" form="asset-form" disabled={isSubmitting}>{isSubmitting ? 'Mendaftarkan…' : `Daftarkan ${qty} unit`}</Button></>}
    >
      <form id="asset-form" onSubmit={submit} noValidate className="grid gap-4 sm:grid-cols-2">
        <Field label="Barang" error={err('itemId')} required className="sm:col-span-2">
          {(p) => (<Select {...p} {...register('itemId')}><option value="">Pilih master barang</option>{items.data?.map((o) => <option key={o.id} value={o.id}>{optionLabel(o)}</option>)}</Select>)}
        </Field>
        <Field label="Jumlah unit" error={err('quantity')} required>{(p) => <Input {...p} type="number" min={1} max={100} inputMode="numeric" {...register('quantity')} />}</Field>
        <Field label="Tahun perolehan" error={err('acquisitionYear')} required>{(p) => <Input {...p} type="number" inputMode="numeric" {...register('acquisitionYear')} />}</Field>
        <Field label="Nomor seri" hint={qty > 1 ? `Satu per baris, urut sesuai ${qty} unit. Kosongkan bila tidak ada.` : 'Kosongkan bila tidak ada.'} error={err('serialText')} className="sm:col-span-2">
          {(p) => <Textarea {...p} rows={Math.min(Math.max(qty, 2), 6)} {...register('serialText')} />}
        </Field>
        <Field label="Tanggal perolehan" error={err('acquisitionDate')}>{(p) => <Input {...p} type="date" {...register('acquisitionDate')} />}</Field>
        <Field label="Harga perolehan per unit (Rp)" error={err('acquisitionCost')}>{(p) => <Input {...p} type="number" min={0} inputMode="numeric" {...register('acquisitionCost')} />}</Field>
        <Field label="Sumber perolehan" error={err('fundingSourceId')}>
          {(p) => (<Select {...p} {...register('fundingSourceId')}><option value="">Tidak ditentukan</option>{funding.data?.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</Select>)}
        </Field>
        <Field label="Vendor" error={err('vendorId')}>
          {(p) => (<Select {...p} {...register('vendorId')}><option value="">Tidak ditentukan</option>{vendors.data?.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</Select>)}
        </Field>
        <Field label="Unit pengelola" error={err('unitId')} required>
          {(p) => (<Select {...p} {...register('unitId')}><option value="">Pilih unit</option>{units.data?.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</Select>)}
        </Field>
        <Field label="Lokasi fisik" error={err('locationId')} required>
          {(p) => (<Select {...p} {...register('locationId')}><option value="">Pilih lokasi</option>{locations.data?.map((o) => <option key={o.id} value={o.id}>{optionLabel(o)}</option>)}</Select>)}
        </Field>
        <Field label="Penanggung jawab" error={err('personId')}>
          {(p) => (<Select {...p} {...register('personId')}><option value="">Tidak ditentukan</option>{persons.data?.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</Select>)}
        </Field>
        <Field label="Kondisi" error={err('condition')} required>
          {(p) => (<Select {...p} {...register('condition')}>{ASSET_CONDITIONS.map((c) => <option key={c} value={c}>{ASSET_CONDITION_LABEL[c]}</option>)}</Select>)}
        </Field>
        <Field label="Catatan" error={err('notes')} className="sm:col-span-2">{(p) => <Textarea {...p} {...register('notes')} />}</Field>
      </form>
    </Dialog>
  );
}

export function AssetsPage() {
  const { can } = useAuth();
  const navigate = useNavigate();
  const list = useListState({ sortBy: 'code' });
  const [registering, setRegistering] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const s = list.state;
  const categories = useOptions('/categories');
  const locations = useOptions('/locations');

  const query = useQuery({
    queryKey: ['assets', s],
    queryFn: ({ signal }) => api.get<AssetRow[]>(`/assets${buildQuery({ page: s.page, limit: s.limit, search: s.search, sortBy: s.sortBy, sortOrder: s.sortOrder, ...s.filters })}`, signal),
    placeholderData: keepPreviousData,
  });
  const rows = query.data?.data;
  const pageIds = rows?.map((r) => r.id) ?? [];
  const allOnPage = pageIds.length > 0 && pageIds.every((id) => selected.has(id));
  const toggle = (id: string, on: boolean) => setSelected((prev) => { const n = new Set(prev); if (on) n.add(id); else n.delete(id); return n; });
  const canPrint = can('assets.print_qr');

  const columns: Column<AssetRow>[] = [
    ...(canPrint ? [{
      key: 'select', header: 'Pilih', className: 'w-12',
      cell: (r: AssetRow) => <Checkbox aria-label={`Pilih ${r.code}`} checked={selected.has(r.id)} onChange={(e) => toggle(r.id, e.target.checked)} label="" className="min-h-0" />,
    }] : []),
    { key: 'code', header: 'Kode inventaris', sortable: true, cell: (r) => <Link to={`/aset/${r.id}`} className="rounded-tag hover:underline"><CodeStamp>{r.code}</CodeStamp></Link> },
    { key: 'itemName', header: 'Barang', sortable: true, cell: (r) => (<div><div className="font-medium">{r.item.name}</div><div className="text-xs text-muted">{r.serialNumber ? `SN ${r.serialNumber}` : r.item.category.name}</div></div>) },
    { key: 'location', header: 'Lokasi', cell: (r) => (<div><div>{r.location.name}</div><div className="text-xs text-muted">{r.unit.name}</div></div>) },
    { key: 'person', header: 'Penanggung jawab', cell: (r) => r.person?.name ?? <span className="text-muted">-</span> },
    { key: 'condition', header: 'Kondisi', sortable: true, cell: (r) => <ConditionBadge value={r.condition} /> },
    { key: 'status', header: 'Status', sortable: true, cell: (r) => <StatusBadge value={r.status} /> },
  ];

  return (
    <>
      <PageHeader
        title="Aset Inventaris"
        description="Setiap unit aset memiliki kode unik dan QR Code individual."
        actions={<>
          {canPrint && <Button variant="secondary" disabled={selected.size === 0} onClick={() => navigate('/aset/cetak-qr', { state: { ids: [...selected] } })}><Printer className="size-4" aria-hidden /> Cetak QR ({selected.size})</Button>}
          {can('assets.create') && <Button onClick={() => setRegistering(true)}><Plus className="size-4" aria-hidden /> Registrasi aset</Button>}
        </>}
      />
      <div className="mb-3 flex flex-wrap gap-2">
        <div className="relative min-w-56 flex-1 sm:max-w-xs">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" aria-hidden />
          <Input aria-label="Cari aset" placeholder="Cari kode, nomor seri, atau nama" className="pl-9" value={list.searchInput} onChange={(e) => list.setSearchInput(e.target.value)} />
        </div>
        <Select aria-label="Filter kategori" className="w-auto" value={s.filters.categoryId ?? ''} onChange={(e) => list.setFilter('categoryId', e.target.value)}>
          <option value="">Semua kategori</option>{categories.data?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </Select>
        <Select aria-label="Filter lokasi" className="w-auto" value={s.filters.locationId ?? ''} onChange={(e) => list.setFilter('locationId', e.target.value)}>
          <option value="">Semua lokasi</option>{locations.data?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </Select>
        <Select aria-label="Filter kondisi" className="w-auto" value={s.filters.condition ?? ''} onChange={(e) => list.setFilter('condition', e.target.value)}>
          <option value="">Semua kondisi</option>{ASSET_CONDITIONS.map((c) => <option key={c} value={c}>{ASSET_CONDITION_LABEL[c]}</option>)}
        </Select>
        <Select aria-label="Filter status" className="w-auto" value={s.filters.status ?? ''} onChange={(e) => list.setFilter('status', e.target.value)}>
          <option value="">Semua status</option>{ASSET_STATUSES.map((c) => <option key={c} value={c}>{ASSET_STATUS_LABEL[c]}</option>)}
        </Select>
      </div>
      {canPrint && rows && rows.length > 0 && (
        <div className="mb-2 flex items-center gap-3 text-sm">
          <Checkbox label="Pilih semua di halaman ini" checked={allOnPage} onChange={(e) => setSelected((prev) => { const n = new Set(prev); pageIds.forEach((id) => (e.target.checked ? n.add(id) : n.delete(id))); return n; })} />
          {selected.size > 0 && <button type="button" className="min-h-8 text-brand underline-offset-2 hover:underline" onClick={() => setSelected(new Set())}>Hapus pilihan</button>}
        </div>
      )}
      <DataTable
        caption="Daftar aset inventaris" columns={columns} rows={rows} rowKey={(r) => r.id}
        loading={query.isFetching} error={query.error ? errMsg(query.error) : null} onRetry={() => void query.refetch()}
        meta={query.data?.meta} sortBy={s.sortBy} sortOrder={s.sortOrder} onSort={list.toggleSort} onPage={list.setPage} onLimit={list.setLimit}
        empty={{ title: 'Belum ada aset', description: s.search || Object.values(s.filters).some(Boolean) ? 'Tidak ada aset yang cocok dengan filter.' : can('assets.create') ? 'Daftarkan unit aset pertama dari master barang.' : undefined }}
      />
      {registering && <RegisterDialog open onClose={() => setRegistering(false)} />}
    </>
  );
}
