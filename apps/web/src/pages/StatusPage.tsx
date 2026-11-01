import { useQuery } from '@tanstack/react-query';
import { apiGet } from '@/lib/api';

interface Health {
  status: string;
  database: string;
  latencyMs: number;
  time: string;
}

/**
 * Halaman Tahap 1: membuktikan rantai web -> API -> PostgreSQL tersambung.
 * Digantikan oleh login dan dashboard pada Tahap 2.
 */
export function StatusPage() {
  const { data, error, isPending, isFetching, refetch } = useQuery({
    queryKey: ['health'],
    queryFn: ({ signal }) => apiGet<Health>('/health', signal),
    retry: false,
  });

  return (
    <main className="mx-auto flex min-h-dvh max-w-xl flex-col justify-center px-4 py-10">
      <h1 className="text-2xl font-semibold text-navy">SIMA</h1>
      <p className="mt-1 text-muted">Sistem Informasi Manajemen Inventaris Barang</p>

      <section
        aria-labelledby="status-title"
        className="mt-8 rounded-card border border-line bg-surface p-5"
      >
        <h2 id="status-title" className="text-base font-semibold">
          Status sistem
        </h2>

        <div className="mt-4" aria-live="polite">
          {isPending && <p className="text-muted">Memeriksa koneksi ke server dan database…</p>}

          {error && (
            <p className="rounded-control border border-danger/30 bg-danger-wash px-3 py-2 text-danger-ink">
              {error.message}. Pastikan API dan database berjalan, lalu coba lagi.
            </p>
          )}

          {data && (
            <dl className="grid grid-cols-[8rem_1fr] gap-y-2">
              <dt className="text-muted">API</dt>
              <dd className="font-medium text-success-ink">Berjalan</dd>
              <dt className="text-muted">Database</dt>
              <dd className="font-medium text-success-ink">
                Tersambung ({data.data.latencyMs} ms)
              </dd>
              <dt className="text-muted">Waktu server</dt>
              <dd>{new Date(data.data.time).toLocaleString('id-ID')}</dd>
            </dl>
          )}
        </div>

        <button
          type="button"
          onClick={() => void refetch()}
          disabled={isFetching}
          className="mt-5 min-h-11 rounded-control bg-navy px-4 font-medium text-white transition-colors duration-150 hover:bg-brand disabled:opacity-60"
        >
          {isFetching ? 'Memeriksa…' : 'Periksa ulang'}
        </button>
      </section>
    </main>
  );
}
