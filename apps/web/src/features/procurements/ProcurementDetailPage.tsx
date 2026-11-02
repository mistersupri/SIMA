import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import { PROCUREMENT_STATUS_LABEL, goodsReceiptSchema } from '@sima/shared';
import { ApiError, api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { formatDate, formatQty, formatRupiah, todayIso } from '@/lib/format';
import { optionLabel, useOptions } from '@/hooks/use-options';
import { Button } from '@/components/ui/button';
import { Field, Input, Select, Textarea } from '@/components/ui/form';
import { CodeStamp, ErrorState, PageHeader, Spinner } from '@/components/ui/misc';
import { Dialog } from '@/components/ui/dialog';
import { ConfirmDialog } from '@/components/ui/confirm';
import { ApprovalTimeline, InfoRow, Panel, StatusTag, errMsg, useDocAction, type Timeline } from '@/features/docs/common';

interface Detail {
  id: string; number: string; date: string; fiscalYear: number; status: string; totalAmount: string; notes: string | null; createdByName: string; vendor: { name: string }; fundingSource: { name: string } | null;
  details: { id: string; quantity: string; unitPrice: string; subtotal: string; receivedQty: string; item: { name: string; code: string; type: 'ASSET' | 'SUPPLY'; unitOfMeasure: { name: string } } }[];
  receipts: { id: string; number: string; status: string; receivedDate: string }[]; approval: Timeline | null;
}

function ReceiveDialog({ p, onClose }: { p: Detail; onClose: () => void }) {
  const qc = useQueryClient();
  const units = useOptions('/organizational-units');
  const locations = useOptions('/locations');
  const persons = useOptions('/persons');
  const warehouses = useOptions('/warehouses');
  const open = p.details.filter((d) => Number(d.quantity) > Number(d.receivedQty));
  const hasAsset = open.some((d) => d.item.type === 'ASSET');
  const hasSupply = open.some((d) => d.item.type === 'SUPPLY');
  const { register, handleSubmit, setError, getValues, formState: { errors, isSubmitting } } = useForm<Record<string, any>>({
    resolver: zodResolver(goodsReceiptSchema as never),
    defaultValues: { receivedDate: todayIso(), warehouseId: '', assetUnitId: '', assetLocationId: '', assetPersonId: '', notes: '', lines: open.map((d) => ({ procurementDetailId: d.id, quantityReceived: Number(d.quantity) - Number(d.receivedQty) })) },
  });
  const err = (k: string) => errors[k]?.message as string | undefined;
  const lineErr = (i: number, k: string) => ((errors.lines as any)?.[i]?.[k]?.message as string | undefined);

  const submit = handleSubmit(async (values) => {
    // Nilai dari resolver membuang field non-skema (serialText), jadi nomor seri dibaca langsung dari form.
    const raw = getValues('serialText') as string[] | undefined;
    const origin: number[] = [];
    const lines = (values.lines as any[]).flatMap((l, idx) => {
      if (!(Number(l.quantityReceived) > 0)) return [];
      origin.push(idx);
      return [{ ...l, serialNumbers: String(raw?.[idx] ?? '').split('\n').map((x) => x.trim()).filter(Boolean) }];
    });
    try {
      const res = await api.post(`/procurements/${p.id}/receive`, { ...values, lines });
      toast.success(res.message);
      await Promise.all(['procurement', 'procurements', 'receipts'].map((k) => qc.invalidateQueries({ queryKey: [k] })));
      onClose();
    } catch (e) {
      if (e instanceof ApiError && e.errors?.length) {
        // Indeks galat dari server mengacu ke baris yang dikirim; petakan kembali ke baris form.
        e.errors.forEach((fe) => {
          const m = fe.field.match(/^lines\.(\d+)\.(\w+)$/);
          const field = m ? `lines.${origin[Number(m[1])] ?? m[1]}.${m[2] === 'serialNumbers' ? 'serialText' : m[2]}` : fe.field;
          setError(field, { message: fe.message });
        });
      } else toast.error(errMsg(e));
    }
  });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} className="max-w-2xl" title="Catat penerimaan barang" description="Isi jumlah yang benar-benar diterima. Inventaris dan stok baru bertambah setelah penerimaan dikonfirmasi petugas lain."
      footer={<><Button variant="secondary" onClick={onClose}>Batal</Button><Button type="submit" form="receive-form" disabled={isSubmitting}>{isSubmitting ? 'Menyimpan…' : 'Catat penerimaan'}</Button></>}>
      <form id="receive-form" onSubmit={submit} noValidate className="grid gap-4 sm:grid-cols-2">
        <Field label="Tanggal terima" error={err('receivedDate')} required>{(f) => <Input {...f} type="date" {...register('receivedDate')} />}</Field>
        {hasSupply && <Field label="Gudang (persediaan)" error={err('warehouseId')} required>{(f) => (<Select {...f} {...register('warehouseId')}><option value="">Pilih gudang</option>{warehouses.data?.map((o) => <option key={o.id} value={o.id}>{optionLabel(o)}</option>)}</Select>)}</Field>}
        {hasAsset && (<>
          <Field label="Unit pengelola (aset)" error={err('assetUnitId')} required>{(f) => (<Select {...f} {...register('assetUnitId')}><option value="">Pilih unit</option>{units.data?.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</Select>)}</Field>
          <Field label="Lokasi awal (aset)" error={err('assetLocationId')} required>{(f) => (<Select {...f} {...register('assetLocationId')}><option value="">Pilih lokasi</option>{locations.data?.map((o) => <option key={o.id} value={o.id}>{optionLabel(o)}</option>)}</Select>)}</Field>
          <Field label="Penanggung jawab (aset)" error={err('assetPersonId')}>{(f) => (<Select {...f} {...register('assetPersonId')}><option value="">Tidak ditentukan</option>{persons.data?.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</Select>)}</Field>
        </>)}
        <fieldset className="flex flex-col gap-3 sm:col-span-2">
          <legend className="mb-1 text-sm font-medium">Barang diterima</legend>
          {open.map((d, i) => (
            <div key={d.id} className="grid gap-2 rounded-control border border-line p-3 sm:grid-cols-[1fr_8rem]">
              <div className="text-sm"><p className="font-medium">{d.item.name}</p><p className="text-muted">Sisa {formatQty(Number(d.quantity) - Number(d.receivedQty))} {d.item.unitOfMeasure.name}</p></div>
              <Field label={`Jumlah diterima: ${d.item.name}`} error={lineErr(i, 'quantityReceived')}>{(f) => <Input {...f} type="number" min="0" step="any" {...register(`lines.${i}.quantityReceived`)} />}</Field>
              {d.item.type === 'ASSET' && <Field label={`Nomor seri ${d.item.name} (satu per baris, opsional)`} error={lineErr(i, 'serialText') ?? lineErr(i, 'serialNumbers')} className="sm:col-span-2">{(f) => <Textarea {...f} rows={2} {...register(`serialText.${i}`)} />}</Field>}
            </div>
          ))}
        </fieldset>
        <Field label="Catatan" error={err('notes')} className="sm:col-span-2">{(f) => <Textarea {...f} rows={2} {...register('notes')} />}</Field>
      </form>
    </Dialog>
  );
}

export function ProcurementDetailPage() {
  const { id } = useParams();
  const { can } = useAuth();
  const [receiving, setReceiving] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const q = useQuery({ queryKey: ['procurement', id], queryFn: async () => (await api.get<Detail>(`/procurements/${id}`)).data });
  const act = useDocAction([['procurement'], ['procurements']]);
  if (q.isPending) return <div className="py-16 text-center"><Spinner label="Memuat pengadaan…" /></div>;
  if (q.error) return <ErrorState message={q.error instanceof ApiError && q.error.status === 404 ? 'Pengadaan tidak ditemukan.' : errMsg(q.error)} onRetry={() => void q.refetch()} />;
  const p = q.data;
  const editable = ['DRAFT', 'REJECTED'].includes(p.status);

  return (
    <>
      <PageHeader
        title={`Pengadaan ${p.number}`} description={`Dibuat oleh ${p.createdByName}`}
        actions={<>
          <StatusTag value={p.status} labels={PROCUREMENT_STATUS_LABEL} />
          {editable && can('procurements.update') && <Button asChild variant="secondary"><Link to={`/pengadaan/${p.id}/ubah`}>Ubah</Link></Button>}
          {editable && can('procurements.update') && <Button variant="secondary" onClick={() => setCancelling(true)}>Batalkan</Button>}
          {editable && can('procurements.submit') && <Button disabled={act.isPending} onClick={() => act.mutate({ path: `/procurements/${p.id}/submit` })}>Ajukan persetujuan</Button>}
          {['APPROVED', 'PARTIALLY_RECEIVED'].includes(p.status) && can('goods_receipts.create') && <Button onClick={() => setReceiving(true)}>Terima barang</Button>}
        </>}
      />
      <div className="grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="grid grid-cols-[minmax(0,1fr)] gap-4">
          <Panel title="Rincian barang">
            <div className="-m-4 overflow-x-auto"><table className="w-full min-w-[560px] text-left text-sm">
              <thead><tr className="border-b border-line bg-wash text-muted"><th className="px-4 py-2.5 font-medium">Barang</th><th className="px-4 py-2.5 text-right font-medium">Jumlah</th><th className="px-4 py-2.5 text-right font-medium">Diterima</th><th className="px-4 py-2.5 text-right font-medium">Harga</th><th className="px-4 py-2.5 text-right font-medium">Subtotal</th></tr></thead>
              <tbody>{p.details.map((d) => (
                <tr key={d.id} className="border-b border-line"><td className="px-4 py-3"><span className="font-medium">{d.item.name}</span><span className="block text-xs text-muted">{d.item.code} · {d.item.type === 'ASSET' ? 'Inventaris' : 'Persediaan'}</span></td>
                  <td className="px-4 py-3 text-right">{formatQty(d.quantity)} {d.item.unitOfMeasure.name}</td><td className="px-4 py-3 text-right">{formatQty(d.receivedQty)}</td><td className="px-4 py-3 text-right">{formatRupiah(d.unitPrice)}</td><td className="px-4 py-3 text-right">{formatRupiah(d.subtotal)}</td></tr>))}
                <tr><td colSpan={4} className="px-4 py-3 text-right font-medium">Total</td><td className="px-4 py-3 text-right text-base font-semibold">{formatRupiah(p.totalAmount)}</td></tr></tbody>
            </table></div>
          </Panel>
          <Panel title="Penerimaan barang">
            {p.receipts.length === 0 ? <p className="text-sm text-muted">Belum ada penerimaan.</p> : (
              <ul className="flex flex-col gap-2 text-sm">{p.receipts.map((r) => (<li key={r.id} className="flex items-center justify-between gap-2"><span><CodeStamp>{r.number}</CodeStamp> <span className="ml-2 text-muted">{formatDate(r.receivedDate)}</span></span><StatusTag value={r.status} labels={{ DRAFT: 'Menunggu konfirmasi', CONFIRMED: 'Dikonfirmasi', CANCELLED: 'Dibatalkan' }} /></li>))}</ul>
            )}
            {can('goods_receipts.view') && p.receipts.length > 0 && <Button asChild variant="secondary" size="sm" className="mt-3"><Link to="/penerimaan">Kelola penerimaan</Link></Button>}
          </Panel>
        </div>
        <div className="grid grid-cols-[minmax(0,1fr)] content-start gap-4">
          <Panel title="Informasi"><dl>
            <InfoRow label="Tanggal">{formatDate(p.date)}</InfoRow><InfoRow label="Tahun anggaran">{p.fiscalYear}</InfoRow><InfoRow label="Vendor">{p.vendor.name}</InfoRow>
            <InfoRow label="Sumber dana">{p.fundingSource?.name ?? '-'}</InfoRow><InfoRow label="Catatan">{p.notes ?? '-'}</InfoRow>
          </dl></Panel>
          <Panel title="Persetujuan"><ApprovalTimeline data={p.approval} /></Panel>
        </div>
      </div>
      {receiving && <ReceiveDialog p={p} onClose={() => setReceiving(false)} />}
      <ConfirmDialog open={cancelling} onOpenChange={setCancelling} title="Batalkan pengadaan?" description={`Pengadaan ${p.number} dibatalkan dan tidak dapat diajukan lagi.`} confirmLabel="Batalkan pengadaan" danger
        onConfirm={async () => { await act.mutateAsync({ path: `/procurements/${p.id}/cancel` }); }} />
    </>
  );
}
