import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { formatDateTime, formatQty, formatRupiah } from '@/lib/format';
import { Card, ErrorState, PageHeader, Spinner } from '@/components/ui/misc';
import { errMsg } from '@/features/docs/common';
import { BarList, MonthChart } from './charts';

interface Data {
  stats: Record<'totalAssets' | 'acquisitionValue' | 'supplyItems' | 'supplyQuantity' | 'good' | 'minorDamage' | 'majorDamage' | 'missing' | 'loaned' | 'underMaintenance' | 'lowStock' | 'pendingApprovals' | 'pendingForMe', number>;
  charts: { byCategory: { name: string; value: number }[]; byCondition: { key: string; name: string; value: number }[]; byLocation: { name: string; value: number }[]; procurementPerMonth: { label: string; total: number }[] };
  pendingApprovals: { id: string; entityLabel: string; documentNumber: string; title: string; requestedBy: string; submittedAt: string; path: string }[];
  recentActivity: { id: string; at: string; user: string; text: string }[];
}

function Stat({ label, value, to, hint, tone, allowed = true }: { label: string; value: ReactNode; to: string; hint?: string; tone?: 'danger' | 'warning'; allowed?: boolean }) {
  const body = (
    <>
      <span className="text-xs text-muted">{label}</span>
      <span className={`mt-1 block text-xl font-semibold sm:text-2xl ${tone === 'danger' ? 'text-danger-ink' : tone === 'warning' ? 'text-warning-ink' : 'text-navy'}`}>{value}</span>
      {hint && <span className="mt-0.5 block text-xs text-muted">{hint}</span>}
    </>
  );
  const cls = 'block rounded-card border border-line bg-surface p-4';
  return allowed
    ? <Link to={to} className={`${cls} transition-colors duration-150 hover:border-brand hover:bg-canvas`}>{body}</Link>
    : <div className={cls}>{body}</div>;
}

export function DashboardPage() {
  const { can, user } = useAuth();
  const q = useQuery({ queryKey: ['dashboard'], queryFn: async () => (await api.get<Data>('/reports/dashboard')).data, refetchInterval: 60_000 });
  if (q.isPending) return <div className="py-20 text-center"><Spinner label="Memuat dashboard…" /></div>;
  if (q.error) return <ErrorState message={errMsg(q.error)} onRetry={() => void q.refetch()} />;
  const { stats: s, charts: c } = q.data;
  const approvals = can('approvals.view');

  return (
    <>
      <PageHeader title="Dashboard" description={`Ringkasan inventaris untuk ${user?.name}. Angka diambil langsung dari database.`} />
      <section aria-label="Statistik utama" className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
        <Stat label="Total barang inventaris" value={formatQty(s.totalAssets)} to="/aset" allowed={can('assets.view')} hint="Tidak termasuk yang dihapuskan" />
        <Stat label="Nilai perolehan" value={formatRupiah(s.acquisitionValue)} to="/laporan/assets" allowed={can('reports.view')} />
        <Stat label="Jenis barang persediaan" value={formatQty(s.supplyItems)} to="/persediaan" allowed={can('stocks.view')} />
        <Stat label="Total saldo persediaan" value={formatQty(s.supplyQuantity)} to="/persediaan" allowed={can('stocks.view')} />
        <Stat label="Kondisi baik" value={formatQty(s.good)} to="/aset?condition=GOOD" allowed={can('assets.view')} />
        <Stat label="Rusak ringan" value={formatQty(s.minorDamage)} to="/aset?condition=MINOR_DAMAGE" allowed={can('assets.view')} tone={s.minorDamage ? 'warning' : undefined} />
        <Stat label="Rusak berat" value={formatQty(s.majorDamage)} to="/aset?condition=MAJOR_DAMAGE" allowed={can('assets.view')} tone={s.majorDamage ? 'danger' : undefined} />
        <Stat label="Tidak ditemukan" value={formatQty(s.missing)} to="/aset?status=MISSING" allowed={can('assets.view')} tone={s.missing ? 'danger' : undefined} />
        <Stat label="Sedang dipinjam" value={formatQty(s.loaned)} to="/aset?status=LOANED" allowed={can('assets.view')} />
        <Stat label="Dalam perbaikan" value={formatQty(s.underMaintenance)} to="/aset?status=UNDER_MAINTENANCE" allowed={can('assets.view')} />
        <Stat label="Menunggu persetujuan" value={formatQty(s.pendingApprovals)} to="/persetujuan/menunggu" allowed={approvals} hint={s.pendingForMe ? `${s.pendingForMe} menunggu keputusan Anda` : undefined} tone={s.pendingForMe ? 'warning' : undefined} />
        <Stat label="Stok di bawah minimum" value={formatQty(s.lowStock)} to="/persediaan?belowMin=true" allowed={can('stocks.view')} tone={s.lowStock ? 'danger' : undefined} />
      </section>

      <div className="mt-5 grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-2">
        <Card className="p-4"><h2 className="mb-3 text-sm font-semibold text-navy">Aset per kategori</h2><BarList label="Jumlah aset per kategori" data={c.byCategory} empty="Belum ada aset terdaftar." /></Card>
        <Card className="p-4"><h2 className="mb-3 text-sm font-semibold text-navy">Aset per kondisi</h2>
          <BarList label="Jumlah aset per kondisi" empty="Belum ada aset terdaftar." data={c.byCondition.map((d) => ({ name: d.name, value: d.value, tone: d.key === 'GOOD' ? 'success' : d.key === 'MINOR_DAMAGE' ? 'warning' : 'danger' }))} />
        </Card>
        <Card className="p-4"><h2 className="mb-3 text-sm font-semibold text-navy">Aset per lokasi (8 teratas)</h2><BarList label="Jumlah aset per lokasi" data={c.byLocation} empty="Belum ada aset terdaftar." /></Card>
        <Card className="p-4"><h2 className="mb-3 text-sm font-semibold text-navy">Pengadaan disetujui per bulan</h2><MonthChart data={c.procurementPerMonth} /></Card>
      </div>

      <div className="mt-4 grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-2">
        {approvals && (
          <Card>
            <div className="flex items-center justify-between border-b border-line px-4 py-3"><h2 className="text-sm font-semibold text-navy">Pengajuan menunggu keputusan Anda</h2><Link to="/persetujuan/menunggu" className="text-sm text-brand hover:underline">Lihat semua</Link></div>
            {q.data.pendingApprovals.length === 0 ? <p className="px-4 py-8 text-center text-sm text-muted">Tidak ada pengajuan yang menunggu Anda.</p> : (
              <ul className="divide-y divide-line">{q.data.pendingApprovals.map((a) => (
                <li key={a.id}><Link to={a.path} className="block min-h-11 px-4 py-2.5 text-sm transition-colors duration-150 hover:bg-canvas"><span className="code-stamp">{a.documentNumber}</span> <span className="ml-1 font-medium">{a.entityLabel}</span><span className="mt-0.5 line-clamp-1 block text-muted">{a.title}</span><span className="text-xs text-muted">{a.requestedBy} · {formatDateTime(a.submittedAt)}</span></Link></li>))}</ul>
            )}
          </Card>
        )}
        <Card className={approvals ? '' : 'lg:col-span-2'}>
          <div className="border-b border-line px-4 py-3"><h2 className="text-sm font-semibold text-navy">Aktivitas terbaru</h2></div>
          {q.data.recentActivity.length === 0 ? <p className="px-4 py-8 text-center text-sm text-muted">Belum ada aktivitas.</p> : (
            <ul className="divide-y divide-line">{q.data.recentActivity.map((a) => (<li key={a.id} className="px-4 py-2.5 text-sm"><span className="font-medium">{a.user}</span> {a.text}<span className="block text-xs text-muted">{formatDateTime(a.at)}</span></li>))}</ul>
          )}
        </Card>
      </div>
    </>
  );
}
