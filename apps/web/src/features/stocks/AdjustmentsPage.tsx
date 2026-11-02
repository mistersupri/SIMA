import { useState } from 'react';
import { Link } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Plus } from 'lucide-react';
import { toast } from 'sonner';
import { DOC_STATUS_LABEL, stockAdjustmentSchema } from '@sima/shared';
import { ApiError, api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { formatQty } from '@/lib/format';
import { optionLabel, useOptions } from '@/hooks/use-options';
import { Button } from '@/components/ui/button';
import { Field, Input, Select, Textarea } from '@/components/ui/form';
import { CodeStamp } from '@/components/ui/misc';
import type { Column } from '@/components/ui/data-table';
import { Dialog } from '@/components/ui/dialog';
import { ConfirmDialog } from '@/components/ui/confirm';
import { RowMenu } from '@/components/ui/row-menu';
import { DocListPage } from '@/features/docs/DocListPage';
import { StatusTag, errMsg, useDocAction } from '@/features/docs/common';

interface Row { id: string; number: string; status: string; quantityDelta: string; reason: string; item: { name: string; unitOfMeasure: { name: string } }; warehouse: { name: string } }

function CreateDialog({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const items = useOptions('/items', { type: 'SUPPLY' });
  const warehouses = useOptions('/warehouses');
  const { register, handleSubmit, setError, formState: { errors, isSubmitting } } = useForm<Record<string, any>>({ resolver: zodResolver(stockAdjustmentSchema as never), defaultValues: { itemId: '', warehouseId: '', quantityDelta: '', reason: '' } });
  const err = (k: string) => errors[k]?.message as string | undefined;
  const submit = handleSubmit(async (v) => {
    try { const r = await api.post('/stocks/adjustments', v); toast.success(r.message); await qc.invalidateQueries({ queryKey: ['adjustments'] }); onClose(); }
    catch (e) { if (e instanceof ApiError && e.errors?.length) e.errors.forEach((fe) => setError(fe.field, { message: fe.message })); else toast.error(errMsg(e)); }
  });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title="Buat penyesuaian stok" description="Selisih positif menambah, negatif mengurangi. Saldo baru berubah setelah penyesuaian disetujui."
      footer={<><Button variant="secondary" onClick={onClose}>Batal</Button><Button type="submit" form="adj-form" disabled={isSubmitting}>{isSubmitting ? 'Menyimpan…' : 'Simpan draft'}</Button></>}>
      <form id="adj-form" onSubmit={submit} noValidate className="flex flex-col gap-4">
        <Field label="Barang" error={err('itemId')} required>{(p) => (<Select {...p} {...register('itemId')}><option value="">Pilih barang persediaan</option>{items.data?.map((o) => <option key={o.id} value={o.id}>{optionLabel(o)}</option>)}</Select>)}</Field>
        <Field label="Gudang" error={err('warehouseId')} required>{(p) => (<Select {...p} {...register('warehouseId')}><option value="">Pilih gudang</option>{warehouses.data?.map((o) => <option key={o.id} value={o.id}>{optionLabel(o)}</option>)}</Select>)}</Field>
        <Field label="Selisih jumlah" hint="Contoh: -8 bila fisik kurang 8, 5 bila fisik lebih 5." error={err('quantityDelta')} required>{(p) => <Input {...p} type="number" step="any" inputMode="decimal" {...register('quantityDelta')} />}</Field>
        <Field label="Alasan" error={err('reason')} required>{(p) => <Textarea {...p} rows={2} {...register('reason')} />}</Field>
      </form>
    </Dialog>
  );
}

export function AdjustmentsPage() {
  const { can } = useAuth();
  const act = useDocAction([['adjustments'], ['stocks']]);
  const [creating, setCreating] = useState(false);
  const [cancelRow, setCancelRow] = useState<Row | null>(null);
  const columns: Column<Row>[] = [
    { key: 'number', header: 'Nomor', sortable: true, cell: (r) => <CodeStamp>{r.number}</CodeStamp> },
    { key: 'item', header: 'Barang', cell: (r) => (<div><div className="font-medium">{r.item.name}</div><div className="text-xs text-muted">{r.warehouse.name} · {r.reason}</div></div>) },
    { key: 'delta', header: 'Selisih', className: 'text-right', cell: (r) => <span className={Number(r.quantityDelta) < 0 ? 'font-medium text-danger-ink' : 'font-medium text-success-ink'}>{Number(r.quantityDelta) > 0 ? '+' : ''}{formatQty(r.quantityDelta)} {r.item.unitOfMeasure.name}</span> },
    { key: 'status', header: 'Status', sortable: true, cell: (r) => <StatusTag value={r.status} labels={DOC_STATUS_LABEL} /> },
    { key: 'actions', header: 'Aksi', className: 'w-16 text-right', cell: (r) => ['DRAFT', 'REJECTED'].includes(r.status) ? (
      <RowMenu label={`Aksi untuk ${r.number}`} items={[
        { label: 'Ajukan persetujuan', hidden: !can('stock_adjustments.submit'), onSelect: () => act.mutate({ path: `/stocks/adjustments/${r.id}/submit` }) },
        { label: 'Batalkan', danger: true, hidden: !can('stock_adjustments.create'), onSelect: () => setCancelRow(r) },
      ]} />) : null },
  ];
  return (
    <>
      <DocListPage<Row> title="Penyesuaian Stok" description="Koreksi saldo hasil hitung fisik. Ledger tidak diedit; koreksi dicatat sebagai transaksi baru setelah disetujui." queryKey="adjustments" path="/stocks/adjustments"
        statusLabels={DOC_STATUS_LABEL} columns={columns} searchPlaceholder="Cari nomor atau barang" emptyTitle="Belum ada penyesuaian"
        extraActions={<>
          <Button asChild variant="secondary"><Link to="/persediaan">Kembali ke persediaan</Link></Button>
          {can('stock_adjustments.create') && <Button onClick={() => setCreating(true)}><Plus className="size-4" aria-hidden /> Buat penyesuaian</Button>}
        </>} />
      {creating && <CreateDialog onClose={() => setCreating(false)} />}
      <ConfirmDialog open={!!cancelRow} onOpenChange={(o) => !o && setCancelRow(null)} title="Batalkan penyesuaian?" description={`${cancelRow?.number} dibatalkan dan saldo tidak berubah.`} confirmLabel="Batalkan" danger
        onConfirm={async () => { await act.mutateAsync({ path: `/stocks/adjustments/${cancelRow!.id}/cancel` }); }} />
    </>
  );
}
