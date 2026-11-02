import { Link } from 'react-router';
import { MUTATION_STATUS_LABEL } from '@sima/shared';
import { formatDate } from '@/lib/format';
import { CodeStamp } from '@/components/ui/misc';
import type { Column } from '@/components/ui/data-table';
import { DocListPage } from '@/features/docs/DocListPage';
import { StatusTag } from '@/features/docs/common';

interface Row { id: string; number: string; date: string; reason: string; status: string; assetCount: number }
const columns: Column<Row>[] = [
  { key: 'number', header: 'Nomor', sortable: true, cell: (r) => <Link to={`/mutasi/${r.id}`} className="hover:underline"><CodeStamp>{r.number}</CodeStamp></Link> },
  { key: 'date', header: 'Tanggal', sortable: true, cell: (r) => formatDate(r.date) },
  { key: 'reason', header: 'Alasan', cell: (r) => <span className="line-clamp-2">{r.reason}</span> },
  { key: 'assetCount', header: 'Aset', className: 'text-right', cell: (r) => r.assetCount },
  { key: 'status', header: 'Status', sortable: true, cell: (r) => <StatusTag value={r.status} labels={MUTATION_STATUS_LABEL} /> },
];

export function MutationsPage() {
  return <DocListPage<Row> title="Mutasi Barang" description="Perpindahan unit, lokasi, atau penanggung jawab aset. Lokasi berubah hanya setelah disetujui dan dikonfirmasi." queryKey="mutations" path="/mutations"
    createTo="/mutasi/baru" createLabel="Buat mutasi" createPermission="mutations.create" statusLabels={MUTATION_STATUS_LABEL} columns={columns} searchPlaceholder="Cari nomor, alasan, atau kode aset" emptyTitle="Belum ada mutasi" />;
}
