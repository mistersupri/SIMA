import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import jsQR from 'jsqr';
import { Camera, CameraOff, Search } from 'lucide-react';
import { ApiError, api } from '@/lib/api';
import { extractAssetCode } from '@/lib/qr-code';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/form';
import { ErrorState, PageHeader, Spinner } from '@/components/ui/misc';

/** Cari aset dari teks QR/kode. Mengembalikan id aset atau melempar Error berpesan jelas. */
async function lookup(text: string): Promise<string> {
  const code = extractAssetCode(text);
  if (!code) throw new Error('Isi QR bukan kode aset SIMA.');
  try {
    return (await api.get<{ id: string }>(`/assets/by-code/${encodeURIComponent(code)}`)).data.id;
  } catch (e) {
    throw new Error(e instanceof ApiError ? e.message : 'Gagal memeriksa kode aset.');
  }
}

/** Halaman tujuan QR (`/q/:kode`): dipakai saat QR dipindai oleh aplikasi kamera bawaan ponsel. */
export function QrResolvePage() {
  const { code } = useParams();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    lookup(code ?? '').then((id) => live && navigate(`/aset/${id}`, { replace: true })).catch((e: Error) => live && setError(e.message));
    return () => { live = false; };
  }, [code, navigate]);
  if (error) return <ErrorState message={error} onRetry={() => navigate('/scan')} />;
  return <div className="py-16 text-center"><Spinner label="Membuka aset…" /></div>;
}

type CameraState = 'idle' | 'starting' | 'scanning';

function cameraErrorMessage(e: unknown) {
  const name = (e as { name?: string })?.name;
  if (!window.isSecureContext) return 'Kamera hanya dapat dipakai lewat HTTPS atau localhost.';
  if (name === 'NotAllowedError') return 'Izin kamera ditolak. Izinkan akses kamera di pengaturan browser, atau masukkan kode secara manual.';
  if (name === 'NotFoundError') return 'Kamera tidak ditemukan di perangkat ini. Masukkan kode secara manual.';
  if (name === 'NotReadableError') return 'Kamera sedang dipakai aplikasi lain.';
  return 'Kamera tidak dapat dibuka. Masukkan kode secara manual.';
}

export function ScanPage() {
  const navigate = useNavigate();
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef(0);
  const busyRef = useRef(false);
  const [state, setState] = useState<CameraState>('idle');
  const [error, setError] = useState<string | null>(null);
  const [manual, setManual] = useState('');
  const [checking, setChecking] = useState(false);

  const stop = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setState('idle');
  }, []);
  useEffect(() => stop, [stop]);

  const handle = useCallback(async (text: string) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setChecking(true);
    try {
      const id = await lookup(text);
      stop();
      navigate(`/aset/${id}`);
    } catch (e) {
      setError((e as Error).message);
      // jeda singkat agar pesan galat tidak berkedip saat QR yang sama masih di depan kamera
      setTimeout(() => { busyRef.current = false; }, 2500);
    } finally {
      setChecking(false);
    }
  }, [navigate, stop]);

  const start = async () => {
    setError(null);
    if (!navigator.mediaDevices?.getUserMedia) { setError(cameraErrorMessage(null)); return; }
    setState('starting');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 } }, audio: false });
      streamRef.current = stream;
      const video = videoRef.current!;
      video.srcObject = stream;
      await video.play();
      setState('scanning');
      busyRef.current = false;

      const Detector = (window as unknown as { BarcodeDetector?: new (o: { formats: string[] }) => { detect: (v: HTMLVideoElement) => Promise<{ rawValue: string }[]> } }).BarcodeDetector;
      const detector = Detector ? new Detector({ formats: ['qr_code'] }) : null;
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
      let last = 0;
      const tick = async (t: number) => {
        rafRef.current = requestAnimationFrame(tick);
        if (t - last < 160 || busyRef.current || video.readyState < 2) return;
        last = t;
        try {
          if (detector) {
            const found = await detector.detect(video);
            if (found[0]) void handle(found[0].rawValue);
          } else {
            const scale = Math.min(1, 640 / video.videoWidth);
            canvas.width = Math.round(video.videoWidth * scale);
            canvas.height = Math.round(video.videoHeight * scale);
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
            const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
            const res = jsQR(img.data, img.width, img.height, { inversionAttempts: 'dontInvert' });
            if (res?.data) void handle(res.data);
          }
        } catch { /* frame gagal dibaca, coba lagi pada frame berikutnya */ }
      };
      rafRef.current = requestAnimationFrame(tick);
    } catch (e) {
      stop();
      setError(cameraErrorMessage(e));
    }
  };

  return (
    <>
      <PageHeader title="Scan QR Code" description="Arahkan kamera ke label QR aset untuk membuka detailnya." />
      <div className="mx-auto grid max-w-2xl gap-4">
        <div className="overflow-hidden rounded-card border border-line bg-navy">
          <div className="relative aspect-[4/3] w-full">
            <video ref={videoRef} muted playsInline className={state === 'scanning' ? 'size-full object-cover' : 'hidden'} aria-label="Pratinjau kamera" />
            {state !== 'scanning' && (
              <div className="absolute inset-0 grid place-items-center p-6 text-center text-slate-200">
                {state === 'starting' ? <Spinner label="Membuka kamera…" /> : <p className="text-sm">Kamera belum aktif.</p>}
              </div>
            )}
            {state === 'scanning' && <div aria-hidden className="pointer-events-none absolute inset-[12%] rounded-card border-2 border-white/80" />}
          </div>
          <div className="flex flex-wrap items-center gap-3 bg-surface p-3">
            {state === 'scanning' ? (
              <Button variant="secondary" onClick={stop}><CameraOff className="size-4" aria-hidden /> Matikan kamera</Button>
            ) : (
              <Button onClick={() => void start()} disabled={state === 'starting'}><Camera className="size-4" aria-hidden /> Nyalakan kamera</Button>
            )}
            {checking && <Spinner label="Memeriksa kode…" />}
          </div>
        </div>

        {error && <p role="alert" className="rounded-control border border-danger/30 bg-danger-wash px-3 py-2 text-sm text-danger-ink">{error}</p>}

        <form className="rounded-card border border-line bg-surface p-4" onSubmit={(e) => { e.preventDefault(); busyRef.current = false; void handle(manual); }}>
          <Field label="Atau masukkan kode inventaris" hint="Contoh: INV-ELK-2026-000001. Tempel isi QR juga diterima.">
            {(p) => (
              <div className="flex gap-2">
                <Input {...p} value={manual} onChange={(e) => setManual(e.target.value)} autoCapitalize="characters" autoComplete="off" spellCheck={false} />
                <Button type="submit" disabled={!manual.trim() || checking}><Search className="size-4" aria-hidden /> Cari</Button>
              </div>
            )}
          </Field>
        </form>
      </div>
    </>
  );
}
