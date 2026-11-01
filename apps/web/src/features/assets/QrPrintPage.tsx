import { Link, useLocation, useSearchParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { Printer } from 'lucide-react';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { EmptyState, ErrorState, PageHeader, Spinner } from '@/components/ui/misc';

interface Label { id: string; code: string; name: string; location: string; unit: string; qr: string }

export function QrPrintPage() {
  const state = useLocation().state as { ids?: string[] } | null;
  const [params] = useSearchParams();
  const ids = state?.ids ?? (params.get('ids')?.split(',').filter(Boolean) ?? []);
  const q = useQuery({
    queryKey: ['bulk-qr', ids],
    enabled: ids.length > 0,
    queryFn: async () => (await api.post<Label[]>('/assets/bulk-qr', { assetIds: ids })).data,
  });

  if (ids.length === 0) {
    return <EmptyState title="Belum ada aset yang dipilih" description="Pilih aset di daftar Aset, lalu tekan Cetak QR." action={<Button asChild variant="secondary"><Link to="/aset">Ke daftar aset</Link></Button>} />;
  }
  if (q.isPending) return <div className="py-16 text-center"><Spinner label="Menyiapkan label…" /></div>;
  if (q.error) return <ErrorState message={q.error.message} onRetry={() => void q.refetch()} />;

  return (
    <>
      <div className="print:hidden">
        <PageHeader title="Cetak label QR" description={`${q.data.length} label. Gunakan kertas stiker; ukuran label 6 × 4 cm.`} actions={<Button onClick={() => window.print()}><Printer className="size-4" aria-hidden /> Cetak</Button>} />
      </div>
      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 print:grid-cols-3 print:gap-2">
        {q.data.map((l) => (
          <li key={l.id} className="flex break-inside-avoid items-center gap-2 rounded-card border border-line bg-surface p-2 print:rounded-none print:border-slate-400">
            <img src={l.qr} alt={`QR ${l.code}`} className="size-20 shrink-0" />
            <div className="min-w-0 text-xs">
              <p className="code-stamp block !px-1 !text-[10px] leading-tight break-all whitespace-normal">{l.code}</p>
              <p className="mt-1 line-clamp-2 font-medium">{l.name}</p>
              <p className="truncate text-muted print:text-slate-700">{l.location}</p>
            </div>
          </li>
        ))}
      </ul>
    </>
  );
}
