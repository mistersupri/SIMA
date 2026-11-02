import { useRef, useState } from 'react';
import { Link } from 'react-router';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Download, FileSpreadsheet, Upload } from 'lucide-react';
import { toast } from 'sonner';
import { ApiError, api, buildQuery } from '@/lib/api';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Checkbox, Select } from '@/components/ui/form';
import { Badge, Card, CodeStamp, ErrorState, PageHeader, Spinner } from '@/components/ui/misc';
import { DataTable, type Column } from '@/components/ui/data-table';
import { ConfirmDialog } from '@/components/ui/confirm';
import { errMsg } from '@/features/docs/common';

interface TypeInfo { key: string; label: string; columns: { key: string; header: string; required?: boolean; note: string }[] }
interface Preview { batchId: string; type: string; fileName: string; total: number; valid: number; errors: number; withWarnings: number; ignoredColumns: string[]; expiresAt: string }
interface RowItem { row: number; status: 'valid' | 'error'; errors: string[]; warnings: string[]; values: Record<string, string> }
interface Result { created: number; skipped: number; skippedRows: { row: number; errors: string[] }[]; codes: string[] }

const LIST_PATH: Record<string, string> = { items: '/barang', assets: '/aset', locations: '/master/locations', 'opening-stock': '/persediaan' };

function RowsTable({ batchId, columns }: { batchId: string; columns: TypeInfo['columns'] }) {
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(20);
  const q = useQuery({
    queryKey: ['import-rows', batchId, status, page, limit], placeholderData: keepPreviousData,
    queryFn: ({ signal }) => api.get<RowItem[]>(`/imports/batches/${batchId}/rows${buildQuery({ status, page, limit })}`, signal),
  });
  const shown = columns.slice(0, 3);
  const cols: Column<RowItem>[] = [
    { key: 'row', header: 'Baris', className: 'w-16', cell: (r) => <CodeStamp>{r.row}</CodeStamp> },
    { key: 'status', header: 'Status', cell: (r) => r.status === 'error' ? <Badge tone="danger">Bermasalah</Badge> : r.warnings.length ? <Badge tone="warning">Valid, ada catatan</Badge> : <Badge tone="success">Valid</Badge> },
    ...shown.map((c) => ({ key: c.key, header: c.header, cell: (r: RowItem) => r.values[c.key] || <span className="text-muted">-</span> })),
    { key: 'msg', header: 'Pesan', cell: (r) => (<ul className="text-sm">{r.errors.map((e, i) => <li key={`e${i}`} className="text-danger-ink">{e}</li>)}{r.warnings.map((w, i) => <li key={`w${i}`} className="text-warning-ink">{w}</li>)}{!r.errors.length && !r.warnings.length && <li className="text-muted">-</li>}</ul>) },
  ];
  return (
    <>
      <div className="mb-2 flex items-center gap-2">
        <Select aria-label="Tampilkan baris" className="w-auto" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}>
          <option value="">Semua baris</option><option value="error">Hanya yang bermasalah</option><option value="valid">Hanya yang valid</option>
        </Select>
      </div>
      <DataTable caption="Hasil pemeriksaan file" columns={cols} rows={q.data?.data} rowKey={(r) => String(r.row)} loading={q.isFetching} error={q.error ? errMsg(q.error) : null} onRetry={() => void q.refetch()}
        meta={q.data?.meta} onPage={setPage} onLimit={(n) => { setLimit(n); setPage(1); }} empty={{ title: 'Tidak ada baris pada filter ini' }} />
    </>
  );
}

export function ImportPage() {
  const types = useQuery({ queryKey: ['import-types'], queryFn: async () => (await api.get<TypeInfo[]>('/imports/types')).data });
  const [key, setKey] = useState<string | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [busy, setBusy] = useState(false);
  const [skip, setSkip] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  if (types.isPending) return <div className="py-16 text-center"><Spinner label="Memuat…" /></div>;
  if (types.error) return <ErrorState message={errMsg(types.error)} onRetry={() => void types.refetch()} />;
  const list = types.data;
  if (!list.length) return <ErrorState message="Akun Anda tidak memiliki izin import data." />;
  const info = list.find((t) => t.key === (key ?? list[0]!.key))!;
  const reset = () => { setPreview(null); setResult(null); setSkip(false); };

  const onFile = async (file: File) => {
    reset(); setBusy(true);
    try {
      const f = new FormData(); f.append('file', file);
      const res = await api.upload<Preview>(`/imports/${info.key}/preview`, f);
      setPreview(res.data);
      toast.success(res.message);
    } catch (e) { toast.error(e instanceof ApiError ? e.message : 'Gagal membaca file'); } finally { setBusy(false); }
  };
  const canCommit = !!preview && preview.valid > 0 && (preview.errors === 0 || skip);

  return (
    <>
      <PageHeader title="Impor Excel" description="Isi data awal dari file Excel. Setiap file diperiksa baris demi baris dan tidak ada yang tersimpan sebelum Anda mengonfirmasi." />
      <div role="tablist" aria-label="Jenis data yang diimpor" className="mb-4 flex gap-1 overflow-x-auto border-b border-line">
        {list.map((t) => (
          <button key={t.key} role="tab" type="button" aria-selected={t.key === info.key} onClick={() => { setKey(t.key); reset(); }}
            className={cn('-mb-px min-h-11 border-b-2 px-3 text-sm whitespace-nowrap transition-colors duration-150', t.key === info.key ? 'border-brand font-semibold text-navy' : 'border-transparent text-muted hover:text-ink')}>{t.label}</button>
        ))}
      </div>

      {!result && (
        <div className="grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-2">
          <Card className="p-4">
            <h2 className="text-sm font-semibold text-navy">1. Unduh template</h2>
            <p className="mt-1 text-sm text-muted">Template berisi header kolom, petunjuk pengisian, dan daftar kode dari Master Data Anda.</p>
            <Button asChild variant="secondary" className="mt-3"><a href={`/api/v1/imports/template?type=${info.key}`} download><FileSpreadsheet className="size-4" aria-hidden /> Unduh template {info.label}</a></Button>
            <details className="mt-3 text-sm"><summary className="min-h-11 cursor-pointer py-2 font-medium sm:min-h-8">Lihat kolom ({info.columns.length})</summary>
              <ul className="mt-1 flex flex-col gap-1">{info.columns.map((c) => <li key={c.key}><span className="font-medium">{c.header}</span>{c.required && <span className="text-danger-ink"> (wajib)</span>}<span className="text-muted">: {c.note}</span></li>)}</ul>
            </details>
          </Card>
          <Card className="p-4">
            <h2 className="text-sm font-semibold text-navy">2. Unggah dan periksa file</h2>
            <p className="mt-1 text-sm text-muted">Format .xlsx, maksimal 5.000 baris. Data dibaca dari lembar pertama mulai baris 2.</p>
            <input ref={fileRef} type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" className="sr-only" aria-label="Pilih file Excel" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void onFile(f); }} />
            <Button className="mt-3" disabled={busy} onClick={() => fileRef.current?.click()}><Upload className="size-4" aria-hidden /> {busy ? 'Memeriksa file…' : 'Pilih file Excel'}</Button>
          </Card>
        </div>
      )}

      {preview && !result && (
        <section aria-label="Hasil pemeriksaan" className="mt-5">
          <h2 className="mb-2 text-sm font-semibold text-navy">3. Periksa hasil: {preview.fileName}</h2>
          <dl className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {[['Total baris', preview.total, ''], ['Valid', preview.valid, 'text-success-ink'], ['Bermasalah', preview.errors, preview.errors ? 'text-danger-ink' : ''], ['Valid dengan catatan', preview.withWarnings, preview.withWarnings ? 'text-warning-ink' : '']].map(([l, v, c]) => (
              <Card key={l as string} className="px-4 py-2.5"><dt className="text-xs text-muted">{l}</dt><dd className={cn('text-xl font-semibold', c as string)}>{v}</dd></Card>))}
          </dl>
          {preview.ignoredColumns.length > 0 && <p className="mb-2 text-sm text-warning-ink">Kolom tidak dikenal diabaikan: {preview.ignoredColumns.join(', ')}.</p>}
          <RowsTable batchId={preview.batchId} columns={info.columns} />
          <Card className="mt-3 flex flex-wrap items-center gap-3 p-4">
            {preview.errors > 0 && (
              <>
                <Button asChild variant="secondary"><a href={`/api/v1/imports/batches/${preview.batchId}/errors`} download><Download className="size-4" aria-hidden /> Unduh laporan kesalahan</a></Button>
                <Checkbox label={`Lewati ${preview.errors} baris bermasalah dan impor sisanya`} checked={skip} onChange={(e) => setSkip(e.target.checked)} />
              </>
            )}
            <Button className="ml-auto" disabled={!canCommit} onClick={() => setConfirm(true)}>Impor {preview.valid} baris valid</Button>
            <Button variant="ghost" onClick={reset}>Batalkan</Button>
          </Card>
          {preview.errors > 0 && !skip && <p className="mt-2 text-sm text-muted">Perbaiki file lalu unggah ulang, atau centang opsi untuk melewati baris bermasalah. Baris bermasalah tidak pernah diimpor.</p>}
        </section>
      )}

      {result && (
        <Card className="mt-2 p-5">
          <h2 className="text-base font-semibold text-navy">Impor selesai</h2>
          <p className="mt-2 text-sm"><span className="font-semibold text-success-ink">{result.created} baris berhasil</span>{result.skipped > 0 && <>, <span className="font-semibold text-danger-ink">{result.skipped} baris dilewati</span></>}.</p>
          {result.skippedRows.length > 0 && (
            <ul className="mt-3 max-h-60 overflow-auto rounded-control border border-line text-sm">{result.skippedRows.map((s) => <li key={s.row} className="border-b border-line px-3 py-2 last:border-0"><CodeStamp>Baris {s.row}</CodeStamp> <span className="ml-1 text-danger-ink">{s.errors.join('; ')}</span></li>)}</ul>
          )}
          <div className="mt-4 flex gap-2"><Button asChild><Link to={LIST_PATH[info.key]!}>Lihat data</Link></Button><Button variant="secondary" onClick={reset}>Impor file lain</Button></div>
        </Card>
      )}

      <ConfirmDialog open={confirm} onOpenChange={setConfirm} title="Impor data sekarang?"
        description={preview ? `${preview.valid} baris akan disimpan ke database${preview.errors ? ` dan ${preview.errors} baris bermasalah dilewati` : ''}. Semua baris disimpan sekaligus; jika terjadi kegagalan, tidak ada yang tersimpan. Tindakan ini tidak dapat diulang untuk file yang sama.` : ''} confirmLabel="Impor"
        onConfirm={async () => {
          try { const r = await api.post<Result>(`/imports/${info.key}/commit`, { batchId: preview!.batchId, skipErrors: skip }); setResult(r.data); toast.success(r.message); }
          catch (e) { toast.error(errMsg(e)); throw e; }
        }} />
    </>
  );
}
