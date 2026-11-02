import { Link } from 'react-router';
import { DISPOSAL_METHOD_LABEL, DOC_STATUS_LABEL } from '@sima/shared';
import { formatDate } from '@/lib/format';
import { CodeStamp } from '@/components/ui/misc';
import type { Column } from '@/components/ui/data-table';
import { DocListPage } from '@/features/docs/DocListPage';
import { StatusTag } from '@/features/docs/common';

interface Row { id: string; number: string; date: string; reason: string; method: keyof typeof DISPOSAL_METHOD_LABEL; status: string; assetCount: number; completedAt: string | null }
const columns = (history: boolean): Column<Row>[] => [
  { key: 'number', header: 'Nomor', sortable: true, cell: (r) => <Link to={`/penghapusan/${r.id}`} className="hover:underline"><CodeStamp>{r.number}</CodeStamp></Link> },
  { key: 'date', header: history ? 'Tanggal pengajuan' : 'Tanggal', sortable: true, cell: (r) => formatDate(r.date) },
  { key: 'reason', header: 'Alasan', cell: (r) => <span className="line-clamp-2">{r.reason}</span> },
  { key: 'method', header: 'Cara', cell: (r) => DISPOSAL_METHOD_LABEL[r.method] },
  { key: 'assetCount', header: 'Aset', className: 'text-right', cell: (r) => r.assetCount },
  ...(history ? [{ key: 'completedAt', header: 'Difinalisasi', cell: (r: Row) => formatDate(r.completedAt) }] : []),
  { key: 'status', header: 'Status', sortable: true, cell: (r) => <StatusTag value={r.status} labels={DOC_STATUS_LABEL} /> },
];

export function DisposalsPage({ history = false }: { history?: boolean }) {
  return <DocListPage<Row>
    title={history ? 'Riwayat Penghapusan' : 'Pengajuan Penghapusan'} queryKey={history ? 'disposals-history' : 'disposals'} path="/disposals"
    description={history ? 'Penghapusan yang sudah difinalisasi. Data dan histori aset tetap tersimpan.' : 'Usulan penghapusan aset. Setelah difinalisasi, aset tidak dapat dipakai lagi tetapi seluruh histori dan QR-nya tetap ada.'}
    createTo={history ? undefined : '/penghapusan/baru'} createLabel="Buat pengajuan" createPermission="disposals.create"
    statusLabels={DOC_STATUS_LABEL} columns={columns(history)} searchPlaceholder="Cari nomor, alasan, atau kode aset" emptyTitle={history ? 'Belum ada penghapusan yang difinalisasi' : 'Belum ada pengajuan penghapusan'}
    fixedParams={history ? { history: 'true' } : undefined} hideStatusFilter={history} />;
}
