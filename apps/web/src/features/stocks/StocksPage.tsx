import { useState } from 'react';
import { Link } from 'react-router';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { useFieldArray, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { ArrowDownToLine, ArrowUpFromLine, Plus, Search, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { STOCK_TX_LABEL, stockInSchema, stockOutSchema } from '@sima/shared';
import { ApiError, api, buildQuery } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { cn } from '@/lib/utils';
import { formatDate, formatQty, todayIso } from '@/lib/format';
import { useListState } from '@/hooks/use-list-state';
import { optionLabel, useOptions } from '@/hooks/use-options';
import { Button } from '@/components/ui/button';
import { Checkbox, Field, Input, Select, Textarea } from '@/components/ui/form';
import { Badge, CodeStamp, PageHeader } from '@/components/ui/misc';
import { DataTable, type Column } from '@/components/ui/data-table';
import { Dialog } from '@/components/ui/dialog';

interface BalanceRow { item: { id: string; code: string; name: string; category: string; unit: string; minStock: string }; quantity: string; belowMin: boolean; balances: { warehouseId: string; warehouse: string; quantity: string }[] }
interface TxRow { id: string; number: string; type: keyof typeof STOCK_TX_LABEL; date: string; warehouse: string; person: string | null; notes: string | null; lines: { itemCode: string; itemName: string; in: string; out: string; balanceAfter: string }[] }
const errMsg = (e: unknown) => (e instanceof ApiError ? e.message : 'Terjadi kesalahan');

function MovementDialog({ mode, onClose }: { mode: 'IN' | 'OUT' | null; onClose: () => void }) {
  const qc = useQueryClient();
  const items = useOptions('/items', { type: 'SUPPLY' });
  const warehouses = useOptions('/warehouses');
  const units = useOptions('/organizational-units');
  const persons = useOptions('/persons');
  const isOut = mode === 'OUT';
  const { register, control, handleSubmit, setError, formState: { errors, isSubmitting } } = useForm<Record<string, any>>({
    resolver: zodResolver((isOut ? stockOutSchema : stockInSchema) as never),
    values: { warehouseId: warehouses.data?.[0]?.id ?? '', date: todayIso(), unitId: '', personId: '', notes: '', lines: [{ itemId: '', quantity: '' }] },
  });
  const { fields, append, remove } = useFieldArray({ control, name: 'lines' });
  const top = (k: string) => errors[k]?.message as string | undefined;
  const lineErr = (i: number, k: string) => ((errors.lines as any)?.[i]?.[k]?.message as string | undefined);

  const submit = handleSubmit(async (values) => {
    try {
      const res = await api.post(isOut ? '/stocks/out' : '/stocks/in', values);
      toast.success(res.message);
      await qc.invalidateQueries({ queryKey: ['stocks'] });
      await qc.invalidateQueries({ queryKey: ['stock-tx'] });
      await qc.invalidateQueries({ queryKey: ['items'] });
      onClose();
    } catch (e) {
      if (e instanceof ApiError && e.errors?.length) e.errors.forEach((fe) => setError(fe.field, { message: fe.message }));
      else toast.error(errMsg(e));
    }
  });

  return (
    <Dialog
      open={!!mode} onOpenChange={(o) => !o && onClose()} className="max-w-2xl"
      title={isOut ? 'Barang keluar' : 'Barang masuk'}
      description={isOut ? 'Pengeluaran langsung mengurangi saldo dan tercatat di kartu stok. Stok tidak boleh negatif.' : 'Penambahan stok dicatat sebagai transaksi ledger.'}
      footer={<><Button variant="secondary" onClick={onClose}>Batal</Button><Button type="submit" form="move-form" disabled={isSubmitting}>{isSubmitting ? 'Menyimpan…' : 'Simpan transaksi'}</Button></>}
    >
      <form id="move-form" onSubmit={submit} noValidate className="flex flex-col gap-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Gudang" error={top('warehouseId')} required>
            {(p) => (<Select {...p} {...register('warehouseId')}><option value="">Pilih gudang</option>{warehouses.data?.map((w) => <option key={w.id} value={w.id}>{optionLabel(w)}</option>)}</Select>)}
          </Field>
          <Field label="Tanggal" error={top('date')} required>{(p) => <Input {...p} type="date" {...register('date')} />}</Field>
          {isOut && (
            <>
              <Field label="Unit penerima" error={top('unitId')}>
                {(p) => (<Select {...p} {...register('unitId')}><option value="">Tidak ditentukan</option>{units.data?.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</Select>)}
              </Field>
              <Field label="Penerima" error={top('personId')}>
                {(p) => (<Select {...p} {...register('personId')}><option value="">Tidak ditentukan</option>{persons.data?.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</Select>)}
              </Field>
            </>
          )}
        </div>

        <fieldset className="flex flex-col gap-3">
          <legend className="mb-1 text-sm font-medium">Barang</legend>
          {top('lines') && <p role="alert" className="text-sm text-danger-ink">{top('lines')}</p>}
          {fields.map((f, i) => (
            <div key={f.id} className="grid grid-cols-[1fr_7rem_auto] items-start gap-2">
              <Field label={`Barang ${i + 1}`} error={lineErr(i, 'itemId')}>
                {(p) => (<Select {...p} {...register(`lines.${i}.itemId`)}><option value="">Pilih barang</option>{items.data?.map((o) => <option key={o.id} value={o.id}>{optionLabel(o)}</option>)}</Select>)}
              </Field>
              <Field label="Jumlah" error={lineErr(i, 'quantity')}>{(p) => <Input {...p} type="number" min="0" step="any" inputMode="decimal" {...register(`lines.${i}.quantity`)} />}</Field>
              <Button variant="ghost" size="icon" aria-label={`Hapus baris ${i + 1}`} className="mt-7" disabled={fields.length === 1} onClick={() => remove(i)}><Trash2 className="size-4" aria-hidden /></Button>
            </div>
          ))}
          <Button variant="secondary" size="sm" className="self-start" onClick={() => append({ itemId: '', quantity: '' })}><Plus className="size-4" aria-hidden /> Tambah baris</Button>
        </fieldset>
        <Field label={isOut ? 'Keperluan' : 'Catatan'} error={top('notes')}>{(p) => <Textarea {...p} rows={2} {...register('notes')} />}</Field>
      </form>
    </Dialog>
  );
}

function BalanceTab() {
  const list = useListState({ sortBy: 'name' });
  const s = list.state;
  const warehouses = useOptions('/warehouses');
  const query = useQuery({
    queryKey: ['stocks', s],
    queryFn: ({ signal }) => api.get<BalanceRow[]>(`/stocks${buildQuery({ page: s.page, limit: s.limit, search: s.search, sortBy: s.sortBy, sortOrder: s.sortOrder, ...s.filters })}`, signal),
    placeholderData: keepPreviousData,
  });
  const columns: Column<BalanceRow>[] = [
    { key: 'code', header: 'Kode', sortable: true, cell: (r) => <CodeStamp>{r.item.code}</CodeStamp> },
    { key: 'name', header: 'Barang', sortable: true, cell: (r) => (<Link to={`/persediaan/${r.item.id}`} className="font-medium hover:underline">{r.item.name}<span className="block text-xs font-normal text-muted">{r.item.category}</span></Link>) },
    { key: 'qty', header: 'Saldo', className: 'text-right', cell: (r) => (<span className={cn('font-medium', r.belowMin && 'text-danger-ink')}>{formatQty(r.quantity)} {r.item.unit}</span>) },
    { key: 'minStock', header: 'Minimum', sortable: true, className: 'text-right', cell: (r) => formatQty(r.item.minStock) },
    { key: 'wh', header: 'Per gudang', cell: (r) => (r.balances.length ? r.balances.map((b) => `${b.warehouse}: ${formatQty(b.quantity)}`).join(' · ') : <span className="text-muted">Belum ada stok</span>) },
    { key: 'alert', header: 'Status', cell: (r) => (r.belowMin ? <Badge tone="danger">Di bawah minimum</Badge> : <Badge tone="success">Aman</Badge>) },
  ];
  return (
    <>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="relative min-w-56 flex-1 sm:max-w-xs">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" aria-hidden />
          <Input aria-label="Cari barang persediaan" placeholder="Cari kode atau nama" className="pl-9" value={list.searchInput} onChange={(e) => list.setSearchInput(e.target.value)} />
        </div>
        <Select aria-label="Filter gudang" className="w-auto" value={s.filters.warehouseId ?? ''} onChange={(e) => list.setFilter('warehouseId', e.target.value)}>
          <option value="">Semua gudang</option>{warehouses.data?.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
        </Select>
        <Checkbox label="Hanya stok menipis" checked={s.filters.belowMin === 'true'} onChange={(e) => list.setFilter('belowMin', e.target.checked ? 'true' : '')} />
      </div>
      <DataTable
        caption="Saldo persediaan" columns={columns} rows={query.data?.data} rowKey={(r) => r.item.id}
        loading={query.isFetching} error={query.error ? errMsg(query.error) : null} onRetry={() => void query.refetch()}
        meta={query.data?.meta} sortBy={s.sortBy} sortOrder={s.sortOrder} onSort={list.toggleSort} onPage={list.setPage} onLimit={list.setLimit}
        empty={{ title: s.filters.belowMin ? 'Tidak ada stok di bawah minimum' : 'Belum ada barang persediaan', description: s.filters.belowMin ? 'Semua barang berada di atas batas minimum.' : 'Tambahkan master barang berjenis Persediaan di menu Data Barang.' }}
      />
    </>
  );
}

function HistoryTab() {
  const list = useListState({ sortBy: 'postedAt', sortOrder: 'desc' });
  const s = list.state;
  const query = useQuery({
    queryKey: ['stock-tx', s],
    queryFn: ({ signal }) => api.get<TxRow[]>(`/stocks/transactions${buildQuery({ page: s.page, limit: s.limit, search: s.search, sortBy: s.sortBy, sortOrder: s.sortOrder, ...s.filters })}`, signal),
    placeholderData: keepPreviousData,
  });
  const columns: Column<TxRow>[] = [
    { key: 'number', header: 'Nomor', sortable: true, cell: (r) => <CodeStamp>{r.number}</CodeStamp> },
    { key: 'date', header: 'Tanggal', sortable: true, cell: (r) => formatDate(r.date) },
    { key: 'type', header: 'Jenis', cell: (r) => <Badge tone={r.type === 'OUT' ? 'warning' : r.type === 'ADJUSTMENT' ? 'info' : 'success'}>{STOCK_TX_LABEL[r.type]}</Badge> },
    { key: 'lines', header: 'Barang', cell: (r) => (<ul className="text-sm">{r.lines.map((l, i) => <li key={i}>{l.itemName}: <span className="font-medium">{Number(l.in) > 0 ? `+${formatQty(l.in)}` : `-${formatQty(l.out)}`}</span></li>)}</ul>) },
    { key: 'warehouse', header: 'Gudang', cell: (r) => r.warehouse },
    { key: 'notes', header: 'Keterangan', cell: (r) => [r.person, r.notes].filter(Boolean).join(' · ') || <span className="text-muted">-</span> },
  ];
  return (
    <>
      <div className="mb-3 flex flex-wrap gap-2">
        <div className="relative min-w-56 flex-1 sm:max-w-xs">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" aria-hidden />
          <Input aria-label="Cari transaksi" placeholder="Cari nomor atau keterangan" className="pl-9" value={list.searchInput} onChange={(e) => list.setSearchInput(e.target.value)} />
        </div>
        <Select aria-label="Filter jenis transaksi" className="w-auto" value={s.filters.type ?? ''} onChange={(e) => list.setFilter('type', e.target.value)}>
          <option value="">Semua jenis</option>{(Object.keys(STOCK_TX_LABEL) as (keyof typeof STOCK_TX_LABEL)[]).map((k) => <option key={k} value={k}>{STOCK_TX_LABEL[k]}</option>)}
        </Select>
        <Input aria-label="Dari tanggal" type="date" className="w-auto" value={s.filters.from ?? ''} onChange={(e) => list.setFilter('from', e.target.value)} />
        <Input aria-label="Sampai tanggal" type="date" className="w-auto" value={s.filters.to ?? ''} onChange={(e) => list.setFilter('to', e.target.value)} />
      </div>
      <DataTable
        caption="Riwayat transaksi stok" columns={columns} rows={query.data?.data} rowKey={(r) => r.id}
        loading={query.isFetching} error={query.error ? errMsg(query.error) : null} onRetry={() => void query.refetch()}
        meta={query.data?.meta} sortBy={s.sortBy} sortOrder={s.sortOrder} onSort={list.toggleSort} onPage={list.setPage} onLimit={list.setLimit}
        empty={{ title: 'Belum ada transaksi stok', description: 'Catat barang masuk untuk memulai.' }}
      />
    </>
  );
}

export function StocksPage() {
  const { can } = useAuth();
  const [tab, setTab] = useState<'saldo' | 'riwayat'>('saldo');
  const [move, setMove] = useState<'IN' | 'OUT' | null>(null);
  return (
    <>
      <PageHeader
        title="Persediaan"
        description="Saldo dihitung dari ledger. Setiap perubahan stok menghasilkan transaksi yang tidak dapat diubah."
        actions={<>
          {can('stocks.in') && <Button onClick={() => setMove('IN')}><ArrowDownToLine className="size-4" aria-hidden /> Barang masuk</Button>}
          {can('stocks.out') && <Button variant="secondary" onClick={() => setMove('OUT')}><ArrowUpFromLine className="size-4" aria-hidden /> Barang keluar</Button>}
        </>}
      />
      <div role="tablist" aria-label="Tampilan persediaan" className="mb-4 flex border-b border-line">
        {([['saldo', 'Saldo stok'], ['riwayat', 'Riwayat transaksi']] as const).map(([k, label]) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)} className={cn('-mb-px min-h-11 border-b-2 px-3 text-sm transition-colors duration-150', tab === k ? 'border-brand font-semibold text-navy' : 'border-transparent text-muted hover:text-ink')}>{label}</button>
        ))}
      </div>
      <div role="tabpanel">{tab === 'saldo' ? <BalanceTab /> : <HistoryTab />}</div>
      {move && <MovementDialog mode={move} onClose={() => setMove(null)} />}
    </>
  );
}
