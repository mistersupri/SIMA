import { useCallback, useEffect, useRef, useState } from 'react';
import jsQR from 'jsqr';
import { Camera, CameraOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/misc';

function cameraErrorMessage(e: unknown) {
  const name = (e as { name?: string })?.name;
  if (!window.isSecureContext) return 'Kamera hanya dapat dipakai lewat HTTPS atau localhost.';
  if (name === 'NotAllowedError') return 'Izin kamera ditolak. Izinkan akses kamera di pengaturan browser, atau masukkan kode secara manual.';
  if (name === 'NotFoundError') return 'Kamera tidak ditemukan di perangkat ini. Masukkan kode secara manual.';
  if (name === 'NotReadableError') return 'Kamera sedang dipakai aplikasi lain.';
  return 'Kamera tidak dapat dibuka. Masukkan kode secara manual.';
}

interface Props {
  /** Dipanggil untuk setiap QR terbaca. Nilai yang sama diabaikan selama 2,5 detik. */
  onDecode: (text: string) => void;
  /** Menampilkan indikator sedang memproses hasil pindai. */
  busy?: boolean;
  className?: string;
}

/** Pemindai QR kamera: BarcodeDetector bila ada, jsQR sebagai cadangan. Berhenti otomatis saat komponen dilepas. */
export function CameraScanner({ onDecode, busy, className }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef(0);
  const lastRef = useRef<{ text: string; at: number } | null>(null);
  const onDecodeRef = useRef(onDecode);
  onDecodeRef.current = onDecode;
  const [state, setState] = useState<'idle' | 'starting' | 'scanning'>('idle');
  const [error, setError] = useState<string | null>(null);

  const stop = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setState('idle');
  }, []);
  useEffect(() => stop, [stop]);

  const emit = (text: string) => {
    const now = Date.now();
    if (lastRef.current && lastRef.current.text === text && now - lastRef.current.at < 2500) return;
    lastRef.current = { text, at: now };
    onDecodeRef.current(text);
  };

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
      const Detector = (window as unknown as { BarcodeDetector?: new (o: { formats: string[] }) => { detect: (v: HTMLVideoElement) => Promise<{ rawValue: string }[]> } }).BarcodeDetector;
      const detector = Detector ? new Detector({ formats: ['qr_code'] }) : null;
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
      let last = 0;
      const tick = async (t: number) => {
        rafRef.current = requestAnimationFrame(tick);
        if (t - last < 160 || video.readyState < 2) return;
        last = t;
        try {
          if (detector) {
            const found = await detector.detect(video);
            if (found[0]) emit(found[0].rawValue);
          } else {
            const scale = Math.min(1, 640 / video.videoWidth);
            canvas.width = Math.round(video.videoWidth * scale);
            canvas.height = Math.round(video.videoHeight * scale);
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
            const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
            const res = jsQR(img.data, img.width, img.height, { inversionAttempts: 'dontInvert' });
            if (res?.data) emit(res.data);
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
    <div className={className}>
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
          {state === 'scanning'
            ? <Button variant="secondary" onClick={stop}><CameraOff className="size-4" aria-hidden /> Matikan kamera</Button>
            : <Button onClick={() => void start()} disabled={state === 'starting'}><Camera className="size-4" aria-hidden /> Nyalakan kamera</Button>}
          {busy && <Spinner label="Memeriksa kode…" />}
        </div>
      </div>
      {error && <p role="alert" className="mt-3 rounded-control border border-danger/30 bg-danger-wash px-3 py-2 text-sm text-danger-ink">{error}</p>}
    </div>
  );
}
