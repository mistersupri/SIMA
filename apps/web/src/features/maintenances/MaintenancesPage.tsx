import { Link } from 'react-router';
import { MAINTENANCE_STATUS_LABEL, MAINTENANCE_TYPE_LABEL } from '@sima/shared';
import { formatDate, formatRupiah } from '@/lib/format';
import { CodeStamp } from '@/components/ui/misc';
import type { Column } from '@/components/ui/data-table';
import { DocListPage } from '@/features/docs/DocListPage';
import { StatusTag } from '@/features/docs/common';

interface Row { id: string; number: string; date: string; type: keyof typeof MAINTENANCE_TYPE_LABEL; damageDescription: string; cost: string; status: string; asset: { id: string; code: string; item: { name: string } }; vendor: { name: string } | null }

const columns = (history: boolean): Column<Row>[] => [
  { key: 'number', header: 'Nomor', sortable: true, cell: (r) => <Link to={`/pemeliharaan/${r.id}`} className="hover:underline"><CodeStamp>{r.number}</CodeStamp></Link> },
  { key: 'asset', header: 'Aset', cell: (r) => (<div><CodeStamp>{r.asset.code}</CodeStamp><div className="mt-1 text-sm">{r.asset.item.name}</div></div>) },
  { key: 'damageDescription', header: 'Keluhan', cell: (r) => <span className="line-clamp-2">{r.damageDescription}</span> },
  { key: 'date', header: 'Tanggal', sortable: true, cell: (r) => formatDate(r.date) },
  { key: 'type', header: 'Jenis', cell: (r) => MAINTENANCE_TYPE_LABEL[r.type] },
  ...(history ? [{ key: 'cost', header: 'Biaya', sortable: true, className: 'text-right', cell: (r: Row) => formatRupiah(r.cost) }] : []),
  { key: 'status', header: 'Status', sortable: true, cell: (r) => <StatusTag value={r.status} labels={MAINTENANCE_STATUS_LABEL} /> },
];

export function MaintenancesPage({ history = false }: { history?: boolean }) {
  return <DocListPage<Row>
    title={history ? 'Riwayat Perbaikan' : 'Pemeliharaan dan Perbaikan'} queryKey={history ? 'maintenances-history' : 'maintenances'} path="/maintenances"
    description={history ? 'Perbaikan yang sudah selesai beserta tindakan dan biayanya.' : 'Laporan kerusakan dan perawatan aset. Aset tidak tersedia untuk dipinjam selama dalam perbaikan.'}
    createTo={history ? undefined : '/pemeliharaan/baru'} createLabel="Laporkan pemeliharaan" createPermission="maintenances.create"
    statusLabels={MAINTENANCE_STATUS_LABEL} columns={columns(history)} searchPlaceholder="Cari nomor, keluhan, atau kode aset" emptyTitle={history ? 'Belum ada perbaikan selesai' : 'Belum ada laporan pemeliharaan'}
    fixedParams={history ? { history: 'true' } : undefined} hideStatusFilter={history} />;
}
