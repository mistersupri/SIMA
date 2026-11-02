import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { Search } from 'lucide-react';
import { ApiError, api } from '@/lib/api';
import { extractAssetCode } from '@/lib/qr-code';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/form';
import { ErrorState, PageHeader, Spinner } from '@/components/ui/misc';
import { CameraScanner } from '@/components/camera-scanner';

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

export function ScanPage() {
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const [manual, setManual] = useState('');
  const [checking, setChecking] = useState(false);

  const handle = async (text: string) => {
    setChecking(true);
    try {
      const id = await lookup(text);
      navigate(`/aset/${id}`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setChecking(false);
    }
  };

  return (
    <>
      <PageHeader title="Scan QR Code" description="Arahkan kamera ke label QR aset untuk membuka detailnya." />
      <div className="mx-auto grid max-w-2xl gap-4">
        <CameraScanner busy={checking} onDecode={(t) => { setError(null); void handle(t); }} />
        {error && <p role="alert" className="rounded-control border border-danger/30 bg-danger-wash px-3 py-2 text-sm text-danger-ink">{error}</p>}
        <form className="rounded-card border border-line bg-surface p-4" onSubmit={(e) => { e.preventDefault(); setError(null); void handle(manual); }}>
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
