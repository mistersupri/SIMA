import { useState } from 'react';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Plus, Search } from 'lucide-react';
import { toast } from 'sonner';
import { ITEM_TYPE_LABEL, createItemSchema, updateItemSchema } from '@sima/shared';
import { ApiError, api, buildQuery } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { formatQty } from '@/lib/format';
import { useListState } from '@/hooks/use-list-state';
import { optionLabel, useOptions } from '@/hooks/use-options';
import { Button } from '@/components/ui/button';
import { Field, Input, Select, Textarea } from '@/components/ui/form';
import { Badge, CodeStamp, PageHeader } from '@/components/ui/misc';
import { DataTable, type Column } from '@/components/ui/data-table';
import { Dialog } from '@/components/ui/dialog';
import { ConfirmDialog } from '@/components/ui/confirm';
import { RowMenu } from '@/components/ui/row-menu';

interface ItemRow {
  id: string; code: string; name: string; type: 'ASSET' | 'SUPPLY'; model: string | null; specification: string | null; description: string | null;
  categoryId: string; brandId: string | null; unitOfMeasureId: string; minStock: string; isActive: boolean;
  category: { name: string }; brand: { name: string } | null; unitOfMeasure: { name: string };
  assetCount: number; stockTotal: string | null;
}
const errMsg = (e: unknown) => (e instanceof ApiError ? e.message : 'Terjadi kesalahan');

function ItemFormDialog({ row, onClose }: { row: ItemRow | 'new' | null; onClose: () => void }) {
  const qc = useQueryClient();
  const editing = row && row !== 'new' ? row : null;
  const categories = useOptions('/categories');
  const brands = useOptions('/brands');
  const units = useOptions('/units');
  const { register, handleSubmit, setError, watch, formState: { errors, isSubmitting } } = useForm<Record<string, any>>({
    resolver: zodResolver((editing ? updateItemSchema : createItemSchema) as never),
    values: editing
      ? { name: editing.name, categoryId: editing.categoryId, brandId: editing.brandId ?? '', model: editing.model ?? '', specification: editing.specification ?? '', description: editing.description ?? '', unitOfMeasureId: editing.unitOfMeasureId, minStock: editing.minStock }
      : { name: '', type: 'ASSET', categoryId: '', brandId: '', model: '', specification: '', description: '', unitOfMeasureId: '', minStock: 0 },
  });
  const type = editing?.type ?? watch('type');
  const err = (k: string) => errors[k]?.message as string | undefined;

  const submit = handleSubmit(async (values) => {
    try {
      if (editing) await api.patch(`/items/${editing.id}`, values);
      else await api.post('/items', values);
      toast.success(editing ? 'Master barang diperbarui' : 'Master barang ditambahkan');
      await qc.invalidateQueries({ queryKey: ['items'] });
      onClose();
    } catch (e) {
      if (e instanceof ApiError && e.errors?.length) e.errors.forEach((fe) => setError(fe.field, { message: fe.message }));
      else toast.error(errMsg(e));
    }
  });

  return (
    <Dialog
      open={!!row}
      onOpenChange={(o) => !o && onClose()}
      title={editing ? 'Ubah master barang' : 'Tambah master barang'}
      description={editing ? `Kode ${editing.code}. Jenis barang tidak dapat diubah.` : 'Kode barang dibuat otomatis oleh sistem.'}
      footer={<><Button variant="secondary" onClick={onClose}>Batal</Button><Button type="submit" form="item-form" disabled={isSubmitting}>{isSubmitting ? 'Menyimpan…' : 'Simpan'}</Button></>}
    >
      <form id="item-form" onSubmit={submit} noValidate className="flex flex-col gap-4">
        <Field label="Jenis barang" error={err('type')} required hint={type === 'ASSET' ? 'Inventaris: setiap unit punya kode dan QR sendiri.' : 'Persediaan: dikelola per jumlah lewat ledger stok.'}>
          {(p) => (
            <Select {...p} disabled={!!editing} {...register('type')}>
              <option value="ASSET">{ITEM_TYPE_LABEL.ASSET}</option>
              <option value="SUPPLY">{ITEM_TYPE_LABEL.SUPPLY}</option>
            </Select>
          )}
        </Field>
        <Field label="Nama barang" error={err('name')} required>{(p) => <Input {...p} {...register('name')} />}</Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Kategori" error={err('categoryId')} required>
            {(p) => (<Select {...p} {...register('categoryId')}><option value="">Pilih kategori</option>{categories.data?.map((o) => <option key={o.id} value={o.id}>{optionLabel(o)}</option>)}</Select>)}
          </Field>
          <Field label="Satuan" error={err('unitOfMeasureId')} required>
            {(p) => (<Select {...p} {...register('unitOfMeasureId')}><option value="">Pilih satuan</option>{units.data?.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</Select>)}
          </Field>
          <Field label="Merek" error={err('brandId')}>
            {(p) => (<Select {...p} {...register('brandId')}><option value="">Tidak ditentukan</option>{brands.data?.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</Select>)}
          </Field>
          <Field label="Tipe/model" error={err('model')}>{(p) => <Input {...p} {...register('model')} />}</Field>
        </div>
        <Field label="Spesifikasi" error={err('specification')}>{(p) => <Textarea {...p} {...register('specification')} />}</Field>
        {type === 'SUPPLY' && (
          <Field label="Stok minimum" hint="Peringatan stok menipis muncul bila total saldo di bawah angka ini." error={err('minStock')}>
            {(p) => <Input {...p} type="number" min={0} step="any" inputMode="decimal" {...register('minStock')} />}
          </Field>
        )}
      </form>
    </Dialog>
  );
}

export function ItemsPage() {
  const { can } = useAuth();
  const qc = useQueryClient();
  const list = useListState({ sortBy: 'name' });
  const [form, setForm] = useState<ItemRow | 'new' | null>(null);
  const [toggle, setToggle] = useState<ItemRow | null>(null);
  const s = list.state;
  const categories = useOptions('/categories');

  const query = useQuery({
    queryKey: ['items', s],
    queryFn: ({ signal }) => api.get<ItemRow[]>(`/items${buildQuery({ page: s.page, limit: s.limit, search: s.search, sortBy: s.sortBy, sortOrder: s.sortOrder, ...s.filters })}`, signal),
    placeholderData: keepPreviousData,
  });

  const columns: Column<ItemRow>[] = [
    { key: 'code', header: 'Kode', sortable: true, cell: (r) => <CodeStamp>{r.code}</CodeStamp> },
    { key: 'name', header: 'Nama barang', sortable: true, cell: (r) => (<div><div className="font-medium">{r.name}</div>{(r.brand || r.model) && <div className="text-xs text-muted">{[r.brand?.name, r.model].filter(Boolean).join(' · ')}</div>}</div>) },
    { key: 'type', header: 'Jenis', cell: (r) => <Badge tone={r.type === 'ASSET' ? 'info' : 'neutral'}>{ITEM_TYPE_LABEL[r.type]}</Badge> },
    { key: 'category', header: 'Kategori', cell: (r) => r.category.name },
    { key: 'qty', header: 'Jumlah', className: 'text-right', cell: (r) => (r.type === 'ASSET' ? `${r.assetCount} unit` : `${formatQty(r.stockTotal)} ${r.unitOfMeasure.name}`) },
    { key: 'isActive', header: 'Status', cell: (r) => <Badge tone={r.isActive ? 'success' : 'neutral'}>{r.isActive ? 'Aktif' : 'Diarsipkan'}</Badge> },
    ...(can('items.update') || can('items.archive') ? [{ key: 'actions', header: 'Aksi', className: 'w-16 text-right', cell: (r: ItemRow) => (
      <RowMenu label={`Aksi untuk ${r.name}`} items={[
        { label: 'Ubah', hidden: !can('items.update'), onSelect: () => setForm(r) },
        { label: r.isActive ? 'Arsipkan' : 'Aktifkan kembali', danger: r.isActive, hidden: !can('items.archive'), onSelect: () => setToggle(r) },
      ]} />
    ) }] : []),
  ];

  return (
    <>
      <PageHeader
        title="Data Barang"
        description="Master jenis barang. Unit aset individual didaftarkan di menu Aset; saldo persediaan di menu Persediaan."
        actions={can('items.create') ? <Button onClick={() => setForm('new')}><Plus className="size-4" aria-hidden /> Tambah barang</Button> : undefined}
      />
      <div className="mb-3 flex flex-wrap gap-2">
        <div className="relative min-w-56 flex-1 sm:max-w-xs">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" aria-hidden />
          <Input aria-label="Cari barang" placeholder="Cari kode, nama, atau model" className="pl-9" value={list.searchInput} onChange={(e) => list.setSearchInput(e.target.value)} />
        </div>
        <Select aria-label="Filter jenis" className="w-auto" value={s.filters.type ?? ''} onChange={(e) => list.setFilter('type', e.target.value)}>
          <option value="">Semua jenis</option><option value="ASSET">Inventaris</option><option value="SUPPLY">Persediaan</option>
        </Select>
        <Select aria-label="Filter kategori" className="w-auto" value={s.filters.categoryId ?? ''} onChange={(e) => list.setFilter('categoryId', e.target.value)}>
          <option value="">Semua kategori</option>{categories.data?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </Select>
        <Select aria-label="Filter status" className="w-auto" value={s.filters.isActive ?? ''} onChange={(e) => list.setFilter('isActive', e.target.value)}>
          <option value="">Semua status</option><option value="true">Aktif</option><option value="false">Diarsipkan</option>
        </Select>
      </div>
      <DataTable
        caption="Daftar master barang" columns={columns} rows={query.data?.data} rowKey={(r) => r.id}
        loading={query.isFetching} error={query.error ? errMsg(query.error) : null} onRetry={() => void query.refetch()}
        meta={query.data?.meta} sortBy={s.sortBy} sortOrder={s.sortOrder} onSort={list.toggleSort} onPage={list.setPage} onLimit={list.setLimit}
        empty={{ title: 'Belum ada master barang', description: s.search || Object.values(s.filters).some(Boolean) ? 'Tidak ada hasil untuk filter ini.' : can('items.create') ? 'Tambahkan jenis barang pertama.' : undefined }}
      />
      <ItemFormDialog row={form} onClose={() => setForm(null)} />
      <ConfirmDialog
        open={!!toggle} onOpenChange={(o) => !o && setToggle(null)}
        title={toggle?.isActive ? 'Arsipkan barang?' : 'Aktifkan barang kembali?'}
        description={toggle?.isActive ? `"${toggle?.name}" tidak dapat dipilih untuk transaksi baru. Histori tetap tersimpan.` : `"${toggle?.name}" dapat dipakai lagi.`}
        confirmLabel={toggle?.isActive ? 'Arsipkan' : 'Aktifkan'} danger={toggle?.isActive}
        onConfirm={async () => {
          try { await api.post(`/items/${toggle!.id}/${toggle!.isActive ? 'archive' : 'unarchive'}`); toast.success('Status barang diperbarui'); await qc.invalidateQueries({ queryKey: ['items'] }); }
          catch (e) { toast.error(errMsg(e)); throw e; }
        }}
      />
    </>
  );
}
