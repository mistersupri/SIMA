import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Camera, CloudOff, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { ASSET_CONDITIONS, ASSET_CONDITION_LABEL, OPNAME_RESULT_LABEL } from '@sima/shared';
import { ApiError, api } from '@/lib/api';
import { extractAssetCode } from '@/lib/qr-code';
import { readQueue, writeQueue, type QueuedScan } from '@/lib/offline-queue';
import { useOptions } from '@/hooks/use-options';
import { CameraScanner } from '@/components/camera-scanner';
import { Button } from '@/components/ui/button';
import { Field, Input, Select, Textarea } from '@/components/ui/form';
import { Card, ErrorState, PageHeader, Spinner } from '@/components/ui/misc';
import { ResultBadge } from './labels';

interface Opname { id: string; number: string; title: string; status: string; total: number; summary: Record<string, number>; locationName: string | null }
interface Lookup { id: string; code: string; name: string }
interface Recent { code: string; result: keyof typeof OPNAME_RESULT_LABEL | 'QUEUED'; name?: string }
interface SyncResult { clientId: string; status: 'ok' | 'duplicate' | 'conflict'; message?: string }

const isNetworkError = (e: unknown) => e instanceof ApiError && e.status === 0;
const metaKey = (id: string) => `sima:opname-meta:${id}`;
const LOC_KEY = 'sima:locations-options';
function readJson<T>(key: string): T | null { try { const r = localStorage.getItem(key); return r ? (JSON.parse(r) as T) : null; } catch { return null; } }
function writeJson(key: string, v: unknown) { try { localStorage.setItem(key, JSON.stringify(v)); } catch { /* penyimpanan penuh/diblokir */ } }

export function OpnameScanPage() {
  const { id = '' } = useParams();
  const qc = useQueryClient();
  const locationsQuery = useOptions('/locations');
  useEffect(() => { if (locationsQuery.data) writeJson(LOC_KEY, locationsQuery.data); }, [locationsQuery.data]);
  const locations = { data: locationsQuery.data ?? readJson<{ id: string; name: string }[]>(LOC_KEY) ?? undefined };
  const opnameQuery = useQuery({
    queryKey: ['opname', id],
    queryFn: async () => { const d = (await api.get<Opname>(`/stock-opnames/${id}`)).data; writeJson(metaKey(id), d); return d; },
    refetchInterval: 20_000,
  });
  // Offline: pakai salinan terakhir sesi ini agar petugas dapat melanjutkan pemeriksaan.
  const cachedOpname = isNetworkError(opnameQuery.error) ? readJson<Opname>(metaKey(id)) : null;
  const opname = cachedOpname ? { ...opnameQuery, data: cachedOpname, error: null, isPending: false } : opnameQuery;
  const [code, setCode] = useState<string | null>(null);
  const [info, setInfo] = useState<Lookup | null>(null);
  const [manual, setManual] = useState('');
  const [foundLocationId, setFoundLocationId] = useState('');
  const [foundCondition, setFoundCondition] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recent, setRecent] = useState<Recent[]>([]);
  const [lastDetailId, setLastDetailId] = useState<string | null>(null);
  const [queue, setQueue] = useState<QueuedScan[]>(() => readQueue(id));
  const [online, setOnline] = useState(() => navigator.onLine);
  const [syncing, setSyncing] = useState(false);
  const photoRef = useRef<HTMLInputElement>(null);

  const persist = useCallback((next: QueuedScan[]) => { setQueue(next); if (!writeQueue(id, next)) toast.error('Penyimpanan perangkat penuh atau diblokir. Catatan offline tidak dapat disimpan.'); }, [id]);

  const inFlight = useRef(false);
  const sync = useCallback(async (items: QueuedScan[]) => {
    // Pemicu mount dan event 'online' dapat datang bersamaan; satu sinkronisasi pada satu waktu.
    if (!items.length || inFlight.current) return;
    inFlight.current = true;
    setSyncing(true);
    try {
      const res = await api.post<{ results: SyncResult[]; accepted: number; conflicts: number }>(`/stock-opnames/${id}/sync`, { records: items.map(({ conflict: _c, ...r }) => r) });
      const by = new Map(res.data.results.map((r) => [r.clientId, r]));
      // Yang diterima/duplikat dihapus dari antrean; yang konflik ditahan dengan alasannya untuk ditinjau.
      persist(items.filter((i) => by.get(i.clientId)?.status === 'conflict').map((i) => ({ ...i, conflict: by.get(i.clientId)?.message ?? 'Ditolak server' })));
      if (res.data.accepted) toast.success(`${res.data.accepted} catatan offline tersinkron`);
      if (res.data.conflicts) toast.error(`${res.data.conflicts} catatan konflik, tinjau di bawah`);
      void qc.invalidateQueries({ queryKey: ['opname', id] });
    } catch (e) {
      if (!isNetworkError(e)) toast.error(e instanceof ApiError ? e.message : 'Sinkronisasi gagal');
    } finally { inFlight.current = false; setSyncing(false); }
  }, [id, persist, qc]);

  useEffect(() => {
    const on = () => { setOnline(true); const pending = readQueue(id).filter((q) => !q.conflict); setQueue(readQueue(id)); void sync(pending); };
    const off = () => setOnline(false);
    window.addEventListener('online', on); window.addEventListener('offline', off);
    if (navigator.onLine) { const pending = readQueue(id).filter((q) => !q.conflict); if (pending.length) void sync(pending); }
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); };
  }, [id, sync]);

  const pick = async (text: string) => {
    const c = extractAssetCode(text);
    if (!c) { setError('Isi QR bukan kode aset SIMA.'); return; }
    setError(null); setCode(c); setInfo(null); setFoundLocationId(''); setFoundCondition(''); setNotes(''); setLastDetailId(null);
    try { setInfo((await api.get<Lookup>(`/assets/by-code/${encodeURIComponent(c)}`)).data); }
    catch (e) { if (!isNetworkError(e)) setInfo(null); }
  };

  const save = async () => {
    if (!code) return;
    setSaving(true); setError(null);
    const rec = { clientId: crypto.randomUUID(), clientRecordedAt: new Date().toISOString(), code, foundLocationId: foundLocationId || null, foundCondition: foundCondition || null, notes: notes.trim() || null };
    try {
      const res = await api.post<{ status: string; detail: { id: string; result: keyof typeof OPNAME_RESULT_LABEL } }>(`/stock-opnames/${id}/scan`, rec);
      setRecent((r) => [{ code, result: res.data.detail.result, name: info?.name }, ...r].slice(0, 8));
      setLastDetailId(res.data.detail.id);
      toast.success(`${code}: ${OPNAME_RESULT_LABEL[res.data.detail.result]}`);
      setCode(null); setInfo(null);
      void qc.invalidateQueries({ queryKey: ['opname', id] });
    } catch (e) {
      if (isNetworkError(e)) {
        persist([...queue, rec]);
        setRecent((r) => [{ code, result: 'QUEUED' as const, name: info?.name }, ...r].slice(0, 8));
        toast.message('Offline: catatan disimpan di perangkat dan dikirim saat tersambung');
        setCode(null); setInfo(null);
      } else setError(e instanceof ApiError ? e.message : 'Gagal menyimpan');
    } finally { setSaving(false); }
  };

  const upload = async (file: File) => {
    if (!lastDetailId) return;
    const f = new FormData(); f.append('file', file);
    try { await api.upload(`/stock-opnames/${id}/details/${lastDetailId}/photos`, f); toast.success('Foto ditambahkan'); } catch (e) { toast.error(e instanceof ApiError ? e.message : 'Gagal mengunggah foto'); }
  };

  if (opname.isPending) return <div className="py-16 text-center"><Spinner label="Memuat sesi…" /></div>;
  if (opname.error) return <ErrorState message={opname.error.message} onRetry={() => void opname.refetch()} />;
  const o = opname.data;
  const done = o.total - (o.summary.NOT_CHECKED ?? 0);
  if (o.status !== 'IN_PROGRESS') return <ErrorState message={`Sesi ${o.number} tidak sedang dalam pemeriksaan.`} />;
  const pending = queue.filter((q) => !q.conflict);
  const conflicts = queue.filter((q) => q.conflict);

  return (
    <>
      <PageHeader title="Periksa aset" description={`${o.number}: ${o.title}${o.locationName ? ` (${o.locationName})` : ''}`} actions={<Button asChild variant="secondary"><Link to={`/opname/${id}`}>Lihat hasil</Link></Button>} />
      <div className="mx-auto grid max-w-2xl gap-4">
        <Card className="p-4">
          <div className="flex items-center justify-between text-sm"><span className="font-medium">Diperiksa {done} dari {o.total}</span><span className="text-muted">{o.total ? Math.round((done / o.total) * 100) : 0}%</span></div>
          <div role="progressbar" aria-label="Progres pemeriksaan" aria-valuemin={0} aria-valuemax={o.total} aria-valuenow={done} className="mt-2 h-2 overflow-hidden rounded-full bg-wash"><div className="h-full bg-brand transition-[width] duration-300 ease-out" style={{ width: `${o.total ? (done / o.total) * 100 : 0}%` }} /></div>
        </Card>

        {(!online || queue.length > 0) && (
          <div role="status" className="rounded-card border border-warning/40 bg-warning-wash p-3 text-sm text-warning-ink">
            <p className="flex items-center gap-2 font-medium"><CloudOff className="size-4" aria-hidden /> {online ? 'Ada catatan yang belum terkirim' : 'Anda sedang offline'}</p>
            <p className="mt-1">{pending.length} catatan menunggu sinkronisasi di perangkat ini{online ? '' : '. Pemeriksaan tetap dapat dilanjutkan; foto memerlukan koneksi.'}</p>
            {online && pending.length > 0 && <Button variant="secondary" size="sm" className="mt-2" disabled={syncing} onClick={() => void sync(pending)}><RefreshCw className={syncing ? 'size-4 animate-spin' : 'size-4'} aria-hidden /> Sinkronkan sekarang</Button>}
          </div>
        )}
        {conflicts.length > 0 && (
          <div role="alert" className="rounded-card border border-danger/30 bg-danger-wash p-3 text-sm text-danger-ink">
            <p className="font-medium">{conflicts.length} catatan konflik perlu ditinjau</p>
            <ul className="mt-2 flex flex-col gap-2">{conflicts.map((c) => (
              <li key={c.clientId} className="flex items-start justify-between gap-2"><span><span className="code-stamp">{c.code}</span> {c.conflict}</span><Button variant="secondary" size="sm" onClick={() => persist(queue.filter((q) => q.clientId !== c.clientId))}>Buang</Button></li>))}</ul>
          </div>
        )}

        {!code ? (
          <>
            <CameraScanner onDecode={(t) => void pick(t)} />
            <form className="rounded-card border border-line bg-surface p-4" onSubmit={(e) => { e.preventDefault(); void pick(manual); setManual(''); }}>
              <Field label="Atau masukkan kode inventaris">{(p) => (<div className="flex gap-2"><Input {...p} value={manual} onChange={(e) => setManual(e.target.value)} autoCapitalize="characters" autoComplete="off" spellCheck={false} /><Button type="submit" disabled={!manual.trim()}>Lanjut</Button></div>)}</Field>
            </form>
            {lastDetailId && online && (
              <div className="rounded-card border border-line bg-surface p-3">
                <input ref={photoRef} type="file" accept="image/*" capture="environment" className="sr-only" aria-label="Ambil foto pemeriksaan" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void upload(f); }} />
                <Button variant="secondary" onClick={() => photoRef.current?.click()}><Camera className="size-4" aria-hidden /> Tambah foto untuk pemeriksaan terakhir</Button>
              </div>
            )}
          </>
        ) : (
          <Card className="grid gap-4 p-4">
            <div><p className="text-xs text-muted">Aset terbaca</p><p><span className="code-stamp">{code}</span> <span className="ml-1 font-medium">{info?.name ?? (online ? '' : '(detail tidak tersedia offline)')}</span></p></div>
            <Field label="Lokasi ditemukan" hint="Biarkan 'Sesuai data' bila aset berada di lokasi yang tercatat.">{(p) => (<Select {...p} value={foundLocationId} onChange={(e) => setFoundLocationId(e.target.value)}><option value="">Sesuai data</option>{locations.data?.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</Select>)}</Field>
            <Field label="Kondisi ditemukan">{(p) => (<Select {...p} value={foundCondition} onChange={(e) => setFoundCondition(e.target.value)}><option value="">Sesuai data</option>{ASSET_CONDITIONS.map((c) => <option key={c} value={c}>{ASSET_CONDITION_LABEL[c]}</option>)}</Select>)}</Field>
            <Field label="Catatan">{(p) => <Textarea {...p} rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />}</Field>
            {error && <p role="alert" className="text-sm text-danger-ink">{error}</p>}
            <div className="flex gap-2"><Button disabled={saving} onClick={() => void save()}>{saving ? 'Menyimpan…' : 'Simpan hasil'}</Button><Button variant="ghost" onClick={() => { setCode(null); setError(null); }}>Batal</Button></div>
          </Card>
        )}
        {error && !code && <p role="alert" className="rounded-control border border-danger/30 bg-danger-wash px-3 py-2 text-sm text-danger-ink">{error}</p>}

        {recent.length > 0 && (
          <Card className="p-4">
            <h2 className="mb-2 text-sm font-semibold text-navy">Baru diperiksa</h2>
            <ul className="divide-y divide-line text-sm">{recent.map((r, i) => (
              <li key={i} className="flex items-center justify-between gap-2 py-2"><span><span className="code-stamp">{r.code}</span> {r.name && <span className="ml-1">{r.name}</span>}</span>{r.result === 'QUEUED' ? <span className="text-warning-ink">Menunggu sinkronisasi</span> : <ResultBadge value={r.result} />}</li>))}</ul>
          </Card>
        )}
      </div>
    </>
  );
}
