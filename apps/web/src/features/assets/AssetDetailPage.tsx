import { useRef, useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { ArrowLeft, Camera, Download, Printer, Trash2, Upload } from 'lucide-react';
import { toast } from 'sonner';
import { ASSET_CONDITIONS, ASSET_CONDITION_LABEL, updateAssetSchema } from '@sima/shared';
import { ApiError, api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { cn } from '@/lib/utils';
import { formatDate, formatDateTime, formatRupiah } from '@/lib/format';
import { optionLabel, useOptions } from '@/hooks/use-options';
import { Button } from '@/components/ui/button';
import { Field, Input, Select, Textarea } from '@/components/ui/form';
import { Badge, Card, CodeStamp, EmptyState, ErrorState, Spinner } from '@/components/ui/misc';
import { Dialog } from '@/components/ui/dialog';
import { ConfirmDialog } from '@/components/ui/confirm';
import { ConditionBadge, StatusBadge } from './labels';

interface Detail {
  id: string; code: string; serialNumber: string | null; acquisitionDate: string | null; acquisitionYear: number; acquisitionCost: string; condition: keyof typeof ASSET_CONDITION_LABEL;
  status: 'AVAILABLE' | 'LOANED' | 'UNDER_MAINTENANCE' | 'MISSING' | 'DISPOSED'; notes: string | null; fundingSourceId: string | null; vendorId: string | null; disposedAt: string | null;
  item: { name: string; model: string | null; specification: string | null; category: { name: string }; brand: { name: string } | null; unitOfMeasure: { name: string } };
  unit: { name: string }; person: { name: string; position: string | null } | null; fundingSource: { name: string } | null; vendor: { name: string } | null;
  location: { name: string; parent: { name: string; parent: { name: string } | null } | null };
  photos: { id: string; fileId: string; isPrimary: boolean; caption: string | null }[];
}
interface History {
  location: { id: string; changedAt: string; sourceType: string; note: string | null; fromLocation: string | null; toLocation: string | null; fromUnit: string | null; toUnit: string | null; fromPerson: string | null; toPerson: string | null }[];
  condition: { id: string; changedAt: string; sourceType: string; note: string | null; fromCondition: string | null; toCondition: keyof typeof ASSET_CONDITION_LABEL; fromStatus: string | null; toStatus: Detail['status'] }[];
  loans: { id: string; conditionBefore: string; conditionAfter: string | null; returnedAt: string | null; loan: { number: string; status: string; loanDate: string; expectedReturnDate: string; borrower: { name: string } } }[];
  maintenances: { id: string; number: string; date: string; type: string; status: string; damageDescription: string; cost: string }[];
}
const errMsg = (e: unknown) => (e instanceof ApiError ? e.message : 'Terjadi kesalahan');
const SOURCE_LABEL: Record<string, string> = { REGISTRATION: 'Registrasi', MUTATION: 'Mutasi', OPNAME: 'Stock opname', EDIT: 'Perubahan data', LOAN: 'Peminjaman', RETURN: 'Pengembalian', MAINTENANCE: 'Pemeliharaan', DISPOSAL: 'Penghapusan' };

const TABS = [
  ['info', 'Informasi'], ['foto', 'Foto'], ['qr', 'QR Code'], ['lokasi', 'Histori lokasi'], ['kondisi', 'Kondisi'], ['pinjam', 'Peminjaman'], ['rawat', 'Pemeliharaan'],
] as const;

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (<div className="grid grid-cols-[9rem_1fr] gap-2 border-b border-line py-2.5 last:border-0 sm:grid-cols-[12rem_1fr]"><dt className="text-muted">{label}</dt><dd className="min-w-0 break-words">{children}</dd></div>);
}

function EditDialog({ asset, onClose }: { asset: Detail; onClose: () => void }) {
  const qc = useQueryClient();
  const funding = useOptions('/funding-sources');
  const vendors = useOptions('/vendors');
  const { register, handleSubmit, setError, watch, formState: { errors, isSubmitting } } = useForm<Record<string, any>>({
    resolver: zodResolver(updateAssetSchema as never),
    defaultValues: { serialNumber: asset.serialNumber ?? '', acquisitionDate: asset.acquisitionDate?.slice(0, 10) ?? '', acquisitionYear: asset.acquisitionYear, fundingSourceId: asset.fundingSourceId ?? '', vendorId: asset.vendorId ?? '', acquisitionCost: asset.acquisitionCost, notes: asset.notes ?? '', condition: asset.condition, conditionNote: '' },
  });
  const err = (k: string) => errors[k]?.message as string | undefined;
  const changed = watch('condition') !== asset.condition;
  const submit = handleSubmit(async (v) => {
    try {
      await api.patch(`/assets/${asset.id}`, v);
      toast.success('Aset diperbarui');
      await qc.invalidateQueries({ queryKey: ['asset', asset.id] });
      await qc.invalidateQueries({ queryKey: ['asset-history', asset.id] });
      await qc.invalidateQueries({ queryKey: ['assets'] });
      onClose();
    } catch (e) {
      if (e instanceof ApiError && e.errors?.length) e.errors.forEach((fe) => setError(fe.field, { message: fe.message }));
      else toast.error(errMsg(e));
    }
  });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title="Ubah data aset" description="Lokasi, unit, dan penanggung jawab tidak diubah di sini agar histori tetap tertib." className="max-w-xl"
      footer={<><Button variant="secondary" onClick={onClose}>Batal</Button><Button type="submit" form="asset-edit" disabled={isSubmitting}>{isSubmitting ? 'Menyimpan…' : 'Simpan'}</Button></>}>
      <form id="asset-edit" onSubmit={submit} noValidate className="grid gap-4 sm:grid-cols-2">
        <Field label="Nomor seri" error={err('serialNumber')}>{(p) => <Input {...p} {...register('serialNumber')} />}</Field>
        <Field label="Tahun perolehan" error={err('acquisitionYear')} required>{(p) => <Input {...p} type="number" {...register('acquisitionYear')} />}</Field>
        <Field label="Tanggal perolehan" error={err('acquisitionDate')}>{(p) => <Input {...p} type="date" {...register('acquisitionDate')} />}</Field>
        <Field label="Harga perolehan (Rp)" error={err('acquisitionCost')}>{(p) => <Input {...p} type="number" min={0} {...register('acquisitionCost')} />}</Field>
        <Field label="Sumber perolehan" error={err('fundingSourceId')}>{(p) => (<Select {...p} {...register('fundingSourceId')}><option value="">Tidak ditentukan</option>{funding.data?.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</Select>)}</Field>
        <Field label="Vendor" error={err('vendorId')}>{(p) => (<Select {...p} {...register('vendorId')}><option value="">Tidak ditentukan</option>{vendors.data?.map((o) => <option key={o.id} value={o.id}>{optionLabel(o)}</option>)}</Select>)}</Field>
        <Field label="Kondisi" error={err('condition')} required>{(p) => (<Select {...p} {...register('condition')}>{ASSET_CONDITIONS.map((c) => <option key={c} value={c}>{ASSET_CONDITION_LABEL[c]}</option>)}</Select>)}</Field>
        {changed && <Field label="Alasan perubahan kondisi" error={err('conditionNote')} required>{(p) => <Input {...p} {...register('conditionNote')} />}</Field>}
        <Field label="Catatan" error={err('notes')} className="sm:col-span-2">{(p) => <Textarea {...p} {...register('notes')} />}</Field>
      </form>
    </Dialog>
  );
}

function PhotosTab({ asset, canEdit }: { asset: Detail; canEdit: boolean }) {
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const camRef = useRef<HTMLInputElement>(null);
  const [removing, setRemoving] = useState<Detail['photos'][number] | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: ['asset', asset.id] });
  const upload = useMutation({
    mutationFn: (file: File) => { const f = new FormData(); f.append('file', file); return api.upload(`/assets/${asset.id}/photos`, f); },
    onSuccess: () => { toast.success('Foto ditambahkan'); return refresh(); },
    onError: (e) => toast.error(errMsg(e)),
  });
  const onPick = (e: React.ChangeEvent<HTMLInputElement>) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) upload.mutate(f); };
  const disposed = asset.status === 'DISPOSED';
  return (
    <div>
      {canEdit && !disposed && (
        <div className="mb-4 flex flex-wrap gap-2">
          <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" aria-label="Pilih file foto" onChange={onPick} />
          <input ref={camRef} type="file" accept="image/*" capture="environment" className="sr-only" aria-label="Ambil foto dengan kamera" onChange={onPick} />
          <Button variant="secondary" disabled={upload.isPending} onClick={() => fileRef.current?.click()}><Upload className="size-4" aria-hidden /> {upload.isPending ? 'Mengunggah…' : 'Unggah foto'}</Button>
          <Button variant="secondary" disabled={upload.isPending} onClick={() => camRef.current?.click()}><Camera className="size-4" aria-hidden /> Ambil foto</Button>
          <p className="self-center text-sm text-muted">JPG, PNG, atau WebP, maksimal 10 MB, hingga 10 foto.</p>
        </div>
      )}
      {asset.photos.length === 0 ? <EmptyState title="Belum ada foto" description={canEdit ? 'Unggah foto agar aset mudah dikenali saat pemeriksaan.' : undefined} /> : (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {asset.photos.map((p) => (
            <li key={p.id} className="overflow-hidden rounded-card border border-line">
              <a href={`/api/v1/files/${p.fileId}`} target="_blank" rel="noreferrer"><img src={`/api/v1/files/${p.fileId}`} alt={p.caption ?? `Foto ${asset.item.name}`} loading="lazy" className="aspect-square w-full object-cover" /></a>
              <div className="flex items-center justify-between gap-1 p-2 text-sm">
                {p.isPrimary ? <Badge tone="info">Foto utama</Badge> : canEdit && !disposed ? (
                  <button type="button" className="min-h-8 text-brand hover:underline" onClick={async () => { try { await api.post(`/assets/${asset.id}/photos/${p.id}/primary`); await refresh(); } catch (e) { toast.error(errMsg(e)); } }}>Jadikan utama</button>
                ) : <span />}
                {canEdit && !disposed && <Button variant="ghost" size="icon" aria-label="Hapus foto" onClick={() => setRemoving(p)}><Trash2 className="size-4" aria-hidden /></Button>}
              </div>
            </li>
          ))}
        </ul>
      )}
      <ConfirmDialog open={!!removing} onOpenChange={(o) => !o && setRemoving(null)} title="Hapus foto?" description="Foto dihapus permanen dari penyimpanan." confirmLabel="Hapus foto" danger
        onConfirm={async () => { try { await api.delete(`/assets/${asset.id}/photos/${removing!.id}`); toast.success('Foto dihapus'); await refresh(); } catch (e) { toast.error(errMsg(e)); throw e; } }} />
    </div>
  );
}

function HistoryTable({ head, rows, empty }: { head: string[]; rows: ReactNode[][]; empty: string }) {
  if (!rows.length) return <EmptyState title={empty} />;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[560px] text-left text-sm">
        <thead><tr className="border-b border-line bg-wash text-muted">{head.map((h) => <th key={h} scope="col" className="px-4 py-2.5 font-medium whitespace-nowrap">{h}</th>)}</tr></thead>
        <tbody>{rows.map((r, i) => <tr key={i} className="border-b border-line last:border-0">{r.map((c, j) => <td key={j} className="px-4 py-3 align-top">{c}</td>)}</tr>)}</tbody>
      </table>
    </div>
  );
}

export function AssetDetailPage() {
  const { id } = useParams();
  const { can } = useAuth();
  const navigate = useNavigate();
  const [tab, setTab] = useState<(typeof TABS)[number][0]>('info');
  const [editing, setEditing] = useState(false);
  const asset = useQuery({ queryKey: ['asset', id], queryFn: async () => (await api.get<Detail>(`/assets/${id}`)).data });
  const history = useQuery({ queryKey: ['asset-history', id], enabled: ['lokasi', 'kondisi', 'pinjam', 'rawat'].includes(tab), queryFn: async () => (await api.get<History>(`/assets/${id}/history`)).data });

  if (asset.isPending) return <div className="py-16 text-center"><Spinner label="Memuat aset…" /></div>;
  if (asset.error) return <ErrorState message={asset.error instanceof ApiError && asset.error.status === 404 ? 'Aset tidak ditemukan.' : asset.error.message} onRetry={() => void asset.refetch()} />;
  const a = asset.data;
  const canEdit = can('assets.update');
  const where = [a.location.parent?.parent?.name, a.location.parent?.name, a.location.name].filter(Boolean).join(' › ');

  return (
    <>
      <button type="button" onClick={() => navigate(-1)} className="mb-3 inline-flex min-h-11 items-center gap-1.5 text-sm text-muted hover:text-ink sm:min-h-8"><ArrowLeft className="size-4" aria-hidden /> Kembali</button>
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <p><CodeStamp>{a.code}</CodeStamp></p>
          <h1 className="mt-1.5 text-xl font-semibold text-navy">{a.item.name}</h1>
          <div className="mt-2 flex flex-wrap gap-1.5"><StatusBadge value={a.status} /><ConditionBadge value={a.condition} /></div>
        </div>
        {canEdit && a.status !== 'DISPOSED' && <Button variant="secondary" onClick={() => setEditing(true)}>Ubah data</Button>}
      </div>
      {a.status === 'DISPOSED' && <p role="status" className="mb-4 rounded-control border border-line bg-wash px-3 py-2 text-sm">Aset ini sudah dihapuskan{a.disposedAt ? ` pada ${formatDate(a.disposedAt)}` : ''}. Identitas dan seluruh histori tetap tersimpan, data tidak dapat diubah.</p>}

      <div role="tablist" aria-label="Bagian detail aset" className="-mx-4 mb-4 flex overflow-x-auto border-b border-line px-4 lg:mx-0 lg:px-0">
        {TABS.map(([key, label]) => (
          <button key={key} role="tab" id={`tab-${key}`} aria-selected={tab === key} aria-controls={`panel-${key}`} tabIndex={tab === key ? 0 : -1} type="button" onClick={() => setTab(key)}
            onKeyDown={(e) => { const i = TABS.findIndex((t) => t[0] === tab); if (e.key === 'ArrowRight') setTab(TABS[(i + 1) % TABS.length]![0]); if (e.key === 'ArrowLeft') setTab(TABS[(i - 1 + TABS.length) % TABS.length]![0]); }}
            className={cn('-mb-px min-h-11 border-b-2 px-3 text-sm whitespace-nowrap transition-colors duration-150', tab === key ? 'border-brand font-semibold text-navy' : 'border-transparent text-muted hover:text-ink')}>{label}</button>
        ))}
      </div>

      <Card><div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`} className="p-4">
        {tab === 'info' && (
          <dl className="text-sm">
            <Row label="Kategori">{a.item.category.name}</Row>
            <Row label="Merek / model">{[a.item.brand?.name, a.item.model].filter(Boolean).join(' · ') || '-'}</Row>
            <Row label="Spesifikasi">{a.item.specification ?? '-'}</Row>
            <Row label="Nomor seri">{a.serialNumber ?? '-'}</Row>
            <Row label="Unit pengelola">{a.unit.name}</Row>
            <Row label="Lokasi fisik">{where}</Row>
            <Row label="Penanggung jawab">{a.person ? `${a.person.name}${a.person.position ? ` (${a.person.position})` : ''}` : '-'}</Row>
            <Row label="Tanggal perolehan">{formatDate(a.acquisitionDate)} (tahun {a.acquisitionYear})</Row>
            <Row label="Sumber perolehan">{a.fundingSource?.name ?? '-'}</Row>
            <Row label="Vendor">{a.vendor?.name ?? '-'}</Row>
            <Row label="Harga perolehan">{formatRupiah(a.acquisitionCost)}</Row>
            <Row label="Catatan">{a.notes ?? '-'}</Row>
          </dl>
        )}
        {tab === 'foto' && <PhotosTab asset={a} canEdit={canEdit} />}
        {tab === 'qr' && (
          <div className="flex flex-col items-start gap-4 sm:flex-row">
            <img src={`/api/v1/assets/${a.id}/qr`} alt={`QR Code ${a.code}`} width={224} height={224} className="size-56 rounded-card border border-line bg-white" />
            <div className="text-sm">
              <p className="max-w-sm text-muted">QR ini hanya memuat alamat dengan kode aset, tanpa data sensitif. Saat dipindai, detail aset tetap memeriksa hak akses pengguna.</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button asChild variant="secondary"><a href={`/api/v1/assets/${a.id}/qr?download=1`}><Download className="size-4" aria-hidden /> PNG</a></Button>
                <Button asChild variant="secondary"><a href={`/api/v1/assets/${a.id}/qr?format=svg&download=1`}><Download className="size-4" aria-hidden /> SVG</a></Button>
                {can('assets.print_qr') && <Button variant="secondary" onClick={() => navigate('/aset/cetak-qr', { state: { ids: [a.id] } })}><Printer className="size-4" aria-hidden /> Cetak label</Button>}
              </div>
            </div>
          </div>
        )}
        {['lokasi', 'kondisi', 'pinjam', 'rawat'].includes(tab) && history.isPending && <div className="py-8 text-center"><Spinner /></div>}
        {['lokasi', 'kondisi', 'pinjam', 'rawat'].includes(tab) && history.error && <ErrorState message={history.error.message} onRetry={() => void history.refetch()} />}
        {tab === 'lokasi' && history.data && (
          <HistoryTable empty="Belum ada histori lokasi" head={['Waktu', 'Sumber', 'Dari', 'Ke', 'Catatan']}
            rows={history.data.location.map((h) => [formatDateTime(h.changedAt), SOURCE_LABEL[h.sourceType] ?? h.sourceType, h.fromLocation ? `${h.fromLocation}${h.fromPerson ? ` · ${h.fromPerson}` : ''}` : '-', `${h.toLocation ?? '-'}${h.toPerson ? ` · ${h.toPerson}` : ''}`, h.note ?? '-'])} />
        )}
        {tab === 'kondisi' && history.data && (
          <HistoryTable empty="Belum ada histori kondisi" head={['Waktu', 'Sumber', 'Kondisi', 'Status', 'Catatan']}
            rows={history.data.condition.map((h) => [formatDateTime(h.changedAt), SOURCE_LABEL[h.sourceType] ?? h.sourceType, <span key="c">{h.fromCondition ? `${ASSET_CONDITION_LABEL[h.fromCondition as keyof typeof ASSET_CONDITION_LABEL]} → ` : ''}{ASSET_CONDITION_LABEL[h.toCondition]}</span>, h.toStatus, h.note ?? '-'])} />
        )}
        {tab === 'pinjam' && history.data && (
          <HistoryTable empty="Aset ini belum pernah dipinjam" head={['Nomor', 'Peminjam', 'Tanggal pinjam', 'Rencana kembali', 'Status']}
            rows={history.data.loans.map((l) => [<CodeStamp key="n">{l.loan.number}</CodeStamp>, l.loan.borrower.name, formatDate(l.loan.loanDate), formatDate(l.loan.expectedReturnDate), l.loan.status])} />
        )}
        {tab === 'rawat' && history.data && (
          <HistoryTable empty="Belum ada riwayat pemeliharaan" head={['Nomor', 'Tanggal', 'Jenis', 'Kerusakan', 'Biaya', 'Status']}
            rows={history.data.maintenances.map((m) => [<CodeStamp key="n">{m.number}</CodeStamp>, formatDate(m.date), m.type, m.damageDescription, formatRupiah(m.cost), m.status])} />
        )}
      </div></Card>
      {editing && <EditDialog asset={a} onClose={() => setEditing(false)} />}
      <p className="mt-6 text-sm"><Link to="/aset" className="text-brand hover:underline">Lihat semua aset</Link></p>
    </>
  );
}
