import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ASSET_CONDITION_LABEL, OPNAME_RESULTS, OPNAME_RESULT_LABEL, OPNAME_STATUS_LABEL } from '@sima/shared';
import { ApiError, api, buildQuery } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { cn } from '@/lib/utils';
import { formatDate, formatDateTime } from '@/lib/format';
import { useListState } from '@/hooks/use-list-state';
import { Button } from '@/components/ui/button';
import { Checkbox, Field, Input, Textarea } from '@/components/ui/form';
import { Badge, Card, CodeStamp, ErrorState, PageHeader, Spinner } from '@/components/ui/misc';
import { DataTable, type Column } from '@/components/ui/data-table';
import { Dialog } from '@/components/ui/dialog';
import { ConfirmDialog } from '@/components/ui/confirm';
import { InfoRow, Panel, StatusTag, errMsg } from '@/features/docs/common';
import { ResultBadge } from './labels';

type ResultKey = keyof typeof OPNAME_RESULT_LABEL;
interface Opname {
  id: string; number: string; title: string; status: string; periodStart: string; periodEnd: string; notes: string | null; createdByName: string; verifiedByName: string | null; locationName: string | null; unitName: string | null;
  assignees: { id: string; name: string }[]; summary: Record<ResultKey, number>; total: number; startedAt: string | null; submittedAt: string | null; verifiedAt: string | null; createdById: string;
}
interface Detail {
  id: string; result: ResultKey; scannedCode: string | null; notes: string | null; expectedLocation: string | null; foundLocation: string | null; expectedCondition: keyof typeof ASSET_CONDITION_LABEL | null; foundCondition: keyof typeof ASSET_CONDITION_LABEL | null;
  decision: 'APPLY' | 'REJECT' | null; scannedAt: string | null; asset: { id: string; code: string; status: string; item: { name: string } } | null; photos: { id: string; fileId: string }[];
}

function VerifyDialog({ opname, onClose }: { opname: Opname; onClose: () => void }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['opname-findings', opname.id], queryFn: async () => (await api.get<Detail[]>(`/stock-opnames/${opname.id}/details?findings=true&limit=100`)).data });
  const [choice, setChoice] = useState<Record<string, 'APPLY' | 'REJECT'>>({});
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const rows = q.data ?? [];
  const pending = rows.filter((r) => !choice[r.id]).length;
  const setAll = (d: 'APPLY' | 'REJECT') => setChoice(Object.fromEntries(rows.map((r) => [r.id, d])));
  const submit = async () => {
    setBusy(true);
    try {
      const res = await api.post(`/stock-opnames/${opname.id}/verify`, { note, decisions: rows.map((r) => ({ detailId: r.id, decision: choice[r.id] })) });
      toast.success(res.message);
      await Promise.all(['opname', 'opnames', 'opname-details', 'assets'].map((k) => qc.invalidateQueries({ queryKey: [k] })));
      onClose();
    } catch (e) { toast.error(errMsg(e)); } finally { setBusy(false); }
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} className="max-w-3xl" title="Verifikasi hasil pemeriksaan" description="Terapkan untuk memperbarui data aset sesuai temuan, atau tolak untuk membiarkan data tetap."
      footer={<><Button variant="secondary" onClick={onClose}>Batal</Button><Button disabled={busy || q.isPending || pending > 0} onClick={() => void submit()}>{busy ? 'Menyimpan…' : pending ? `${pending} temuan belum diputuskan` : 'Simpan verifikasi'}</Button></>}>
      {q.isPending && <div className="py-6 text-center"><Spinner /></div>}
      {q.error && <ErrorState message={errMsg(q.error)} />}
      {q.data && rows.length === 0 && <p className="text-sm text-muted">Tidak ada temuan yang tidak sesuai. Verifikasi hanya mengunci hasil.</p>}
      {rows.length > 0 && (
        <>
          <div className="mb-3 flex flex-wrap gap-2"><Button variant="secondary" size="sm" onClick={() => setAll('APPLY')}>Terapkan semua</Button><Button variant="secondary" size="sm" onClick={() => setAll('REJECT')}>Tolak semua</Button></div>
          <ul className="flex flex-col gap-3">
            {rows.map((r) => (
              <li key={r.id} className="rounded-control border border-line p-3 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span>{r.asset ? <><span className="code-stamp">{r.asset.code}</span> <span className="ml-1 font-medium">{r.asset.item.name}</span></> : <span className="font-medium">Kode {r.scannedCode}</span>}</span>
                  <ResultBadge value={r.result} />
                </div>
                <p className="mt-1 text-muted">{[r.result === 'MISMATCH' && r.foundLocation && r.foundLocation !== r.expectedLocation ? `Lokasi: ${r.expectedLocation} → ${r.foundLocation}` : null, r.foundCondition && r.foundCondition !== r.expectedCondition ? `Kondisi: ${ASSET_CONDITION_LABEL[r.expectedCondition!]} → ${ASSET_CONDITION_LABEL[r.foundCondition]}` : null, r.notes].filter(Boolean).join(' · ') || '-'}</p>
                {r.result === 'UNREGISTERED' && <p className="mt-1 text-xs text-muted">Menerapkan hanya mengakui temuan. Pendaftaran aset baru dilakukan manual di menu Aset.</p>}
                <div role="radiogroup" aria-label={`Keputusan untuk ${r.asset?.code ?? r.scannedCode}`} className="mt-2 flex gap-2">
                  {(['APPLY', 'REJECT'] as const).map((d) => (
                    <button key={d} type="button" role="radio" aria-checked={choice[r.id] === d} onClick={() => setChoice((c) => ({ ...c, [r.id]: d }))}
                      className={cn('min-h-11 rounded-control border px-3 text-sm transition-colors duration-150 sm:min-h-9', choice[r.id] === d ? (d === 'APPLY' ? 'border-brand bg-blue-50 font-semibold text-navy' : 'border-danger-ink bg-danger-wash font-semibold text-danger-ink') : 'border-line hover:bg-wash')}>
                      {d === 'APPLY' ? 'Terapkan' : 'Tolak'}
                    </button>
                  ))}
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
      <Field label="Catatan verifikasi" className="mt-4">{(p) => <Textarea {...p} rows={2} value={note} onChange={(e) => setNote(e.target.value)} />}</Field>
    </Dialog>
  );
}

function SubmitDialog({ opname, onClose }: { opname: Opname; onClose: () => void }) {
  const qc = useQueryClient();
  const unchecked = opname.summary.NOT_CHECKED;
  const [mark, setMark] = useState(false);
  const [busy, setBusy] = useState(false);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} className="max-w-md" title="Ajukan hasil pemeriksaan" description="Setelah diajukan, hasil tidak dapat diubah petugas dan menunggu verifikasi."
      footer={<><Button variant="secondary" onClick={onClose}>Batal</Button><Button disabled={busy || (unchecked > 0 && !mark)} onClick={async () => {
        setBusy(true);
        try { const r = await api.post(`/stock-opnames/${opname.id}/submit`, { markUncheckedAsNotFound: mark }); toast.success(r.message); await Promise.all(['opname', 'opnames', 'opname-details'].map((k) => qc.invalidateQueries({ queryKey: [k] }))); onClose(); }
        catch (e) { toast.error(errMsg(e)); } finally { setBusy(false); }
      }}>{busy ? 'Mengajukan…' : 'Ajukan hasil'}</Button></>}>
      {unchecked > 0
        ? <><p className="mb-3 text-sm"><span className="font-semibold">{unchecked} aset</span> belum diperiksa. Lanjutkan pemeriksaan, atau tandai sebagai tidak ditemukan.</p><Checkbox label={`Tandai ${unchecked} aset yang belum diperiksa sebagai tidak ditemukan`} checked={mark} onChange={(e) => setMark(e.target.checked)} /></>
        : <p className="text-sm">Seluruh aset sudah diperiksa.</p>}
    </Dialog>
  );
}

export function OpnameDetailPage() {
  const { id } = useParams();
  const { can, user } = useAuth();
  const qc = useQueryClient();
  const [dialog, setDialog] = useState<'submit' | 'verify' | 'cancel' | 'start' | null>(null);
  const list = useListState({ sortBy: 'result' });
  const s = list.state;
  const q = useQuery({ queryKey: ['opname', id], queryFn: async () => (await api.get<Opname>(`/stock-opnames/${id}`)).data, refetchInterval: (query) => (query.state.data?.status === 'IN_PROGRESS' ? 15_000 : false) });
  const details = useQuery({
    queryKey: ['opname-details', id, s], enabled: !!q.data && q.data.status !== 'DRAFT', placeholderData: keepPreviousData,
    queryFn: ({ signal }) => api.get<Detail[]>(`/stock-opnames/${id}/details${buildQuery({ page: s.page, limit: s.limit, search: s.search, ...s.filters })}`, signal),
  });
  if (q.isPending) return <div className="py-16 text-center"><Spinner label="Memuat sesi…" /></div>;
  if (q.error) return <ErrorState message={q.error instanceof ApiError && q.error.status === 404 ? 'Sesi tidak ditemukan.' : errMsg(q.error)} onRetry={() => void q.refetch()} />;
  const o = q.data;
  const mine = o.assignees.some((a) => a.id === user?.id);
  const checked = o.total - o.summary.NOT_CHECKED;
  const run = async (path: string, ok?: string) => { try { const r = await api.post(path); toast.success(ok ?? r.message); await Promise.all(['opname', 'opnames', 'opname-details'].map((k) => qc.invalidateQueries({ queryKey: [k] }))); } catch (e) { toast.error(errMsg(e)); throw e; } };

  const columns: Column<Detail>[] = [
    { key: 'asset', header: 'Aset', cell: (r) => r.asset ? (<div><Link to={`/aset/${r.asset.id}`} className="hover:underline"><CodeStamp>{r.asset.code}</CodeStamp></Link><div className="mt-1 text-sm">{r.asset.item.name}</div></div>) : (<div><CodeStamp>{r.scannedCode ?? '-'}</CodeStamp><div className="mt-1 text-xs text-muted">Tidak terdaftar</div></div>) },
    { key: 'result', header: 'Hasil', sortable: true, cell: (r) => <ResultBadge value={r.result} /> },
    { key: 'location', header: 'Lokasi', cell: (r) => (r.foundLocation && r.foundLocation !== r.expectedLocation ? <span>{r.expectedLocation} <span className="text-muted">→</span> <span className="font-medium">{r.foundLocation}</span></span> : (r.expectedLocation ?? '-')) },
    { key: 'condition', header: 'Kondisi', cell: (r) => (r.foundCondition && r.foundCondition !== r.expectedCondition ? `${ASSET_CONDITION_LABEL[r.expectedCondition!]} → ${ASSET_CONDITION_LABEL[r.foundCondition]}` : r.expectedCondition ? ASSET_CONDITION_LABEL[r.expectedCondition] : '-') },
    { key: 'notes', header: 'Catatan', cell: (r) => r.notes ?? <span className="text-muted">-</span> },
    { key: 'photos', header: 'Foto', cell: (r) => r.photos.length ? <span className="flex gap-1">{r.photos.map((p) => <a key={p.id} href={`/api/v1/files/${p.fileId}`} target="_blank" rel="noreferrer"><img src={`/api/v1/files/${p.fileId}`} alt="Foto pemeriksaan" className="size-9 rounded-tag border border-line object-cover" /></a>)}</span> : <span className="text-muted">-</span> },
    { key: 'decision', header: 'Keputusan', cell: (r) => r.decision ? <Badge tone={r.decision === 'APPLY' ? 'info' : 'neutral'}>{r.decision === 'APPLY' ? 'Diterapkan' : 'Ditolak'}</Badge> : <span className="text-muted">-</span> },
  ];

  return (
    <>
      <PageHeader title={`${o.number}: ${o.title}`} description={`Dibuat oleh ${o.createdByName}`}
        actions={<>
          <StatusTag value={o.status} labels={OPNAME_STATUS_LABEL} />
          {o.status === 'DRAFT' && can('stock_opnames.create') && <Button onClick={() => setDialog('start')}>Mulai pemeriksaan</Button>}
          {o.status === 'IN_PROGRESS' && mine && can('stock_opnames.scan') && <Button asChild><Link to={`/opname/${o.id}/periksa`}>Mulai periksa</Link></Button>}
          {o.status === 'IN_PROGRESS' && (mine || can('stock_opnames.create')) && can('stock_opnames.submit') && <Button variant="secondary" onClick={() => setDialog('submit')}>Ajukan hasil</Button>}
          {o.status === 'SUBMITTED' && can('stock_opnames.verify') && <Button onClick={() => setDialog('verify')}>Verifikasi hasil</Button>}
          {['DRAFT', 'IN_PROGRESS', 'SUBMITTED'].includes(o.status) && can('stock_opnames.create') && <Button variant="secondary" onClick={() => setDialog('cancel')}>Batalkan</Button>}
        </>} />

      {o.status !== 'DRAFT' && (
        <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-5">
          {OPNAME_RESULTS.map((r) => (
            <button key={r} type="button" aria-pressed={s.filters.result === r} onClick={() => list.setFilter('result', s.filters.result === r ? '' : r)}
              className={cn('min-h-11 rounded-card border bg-surface px-3 py-2 text-left transition-colors duration-150 hover:bg-canvas', s.filters.result === r ? 'border-brand' : 'border-line')}>
              <span className="block text-xl font-semibold">{o.summary[r]}</span><span className="text-xs text-muted">{OPNAME_RESULT_LABEL[r]}</span>
            </button>
          ))}
        </div>
      )}

      <div className="grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="grid grid-cols-[minmax(0,1fr)] content-start gap-3">
          {o.status === 'DRAFT'
            ? <Card className="p-6 text-center text-sm text-muted">Sesi belum dimulai. Saat dimulai, sistem mencatat daftar aset yang harus diperiksa pada lingkup ini.</Card>
            : <>
              <div className="relative max-w-xs"><Input aria-label="Cari hasil" placeholder="Cari kode atau nama aset" value={list.searchInput} onChange={(e) => list.setSearchInput(e.target.value)} /></div>
              <DataTable caption="Hasil pemeriksaan" columns={columns} rows={details.data?.data} rowKey={(r) => r.id} loading={details.isFetching} error={details.error ? errMsg(details.error) : null} onRetry={() => void details.refetch()}
                meta={details.data?.meta} sortBy={s.sortBy} sortOrder={s.sortOrder} onSort={list.toggleSort} onPage={list.setPage} onLimit={list.setLimit} empty={{ title: 'Tidak ada hasil yang cocok' }} />
            </>}
        </div>
        <div className="grid grid-cols-[minmax(0,1fr)] content-start gap-4">
          <Panel title="Informasi"><dl>
            <InfoRow label="Periode">{formatDate(o.periodStart)} - {formatDate(o.periodEnd)}</InfoRow>
            <InfoRow label="Lingkup">{[o.locationName, o.unitName].filter(Boolean).join(' · ') || 'Seluruh aset'}</InfoRow>
            <InfoRow label="Petugas">{o.assignees.map((a) => a.name).join(', ')}</InfoRow>
            <InfoRow label="Progres">{o.status === 'DRAFT' ? '-' : `${checked} dari ${o.total} aset`}</InfoRow>
            <InfoRow label="Diajukan">{formatDateTime(o.submittedAt)}</InfoRow>
            <InfoRow label="Diverifikasi">{o.verifiedAt ? `${formatDateTime(o.verifiedAt)} oleh ${o.verifiedByName}` : '-'}</InfoRow>
            <InfoRow label="Catatan"><span className="whitespace-pre-line">{o.notes ?? '-'}</span></InfoRow>
          </dl></Panel>
        </div>
      </div>

      {dialog === 'submit' && <SubmitDialog opname={o} onClose={() => setDialog(null)} />}
      {dialog === 'verify' && <VerifyDialog opname={o} onClose={() => setDialog(null)} />}
      <ConfirmDialog open={dialog === 'start'} onOpenChange={(x) => !x && setDialog(null)} title="Mulai pemeriksaan?" description="Daftar aset pada lingkup ini dicatat sekarang dan petugas mendapat notifikasi." confirmLabel="Mulai" onConfirm={() => run(`/stock-opnames/${o.id}/start`)} />
      <ConfirmDialog open={dialog === 'cancel'} onOpenChange={(x) => !x && setDialog(null)} title="Batalkan sesi?" description="Sesi dibatalkan dan data aset tidak berubah. Hasil pemeriksaan yang sudah dicatat tetap tersimpan sebagai arsip." confirmLabel="Batalkan sesi" danger onConfirm={() => run(`/stock-opnames/${o.id}/cancel`)} />
    </>
  );
}
