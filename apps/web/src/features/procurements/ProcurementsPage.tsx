import { Link } from 'react-router';
import { PROCUREMENT_STATUS_LABEL } from '@sima/shared';
import { formatDate, formatRupiah } from '@/lib/format';
import { CodeStamp } from '@/components/ui/misc';
import type { Column } from '@/components/ui/data-table';
import { DocListPage } from '@/features/docs/DocListPage';
import { StatusTag } from '@/features/docs/common';

interface Row { id: string; number: string; date: string; fiscalYear: number; vendor: { name: string }; totalAmount: string; status: string; lineCount: number }

const columns: Column<Row>[] = [
  { key: 'number', header: 'Nomor', sortable: true, cell: (r) => <Link to={`/pengadaan/${r.id}`} className="hover:underline"><CodeStamp>{r.number}</CodeStamp></Link> },
  { key: 'date', header: 'Tanggal', sortable: true, cell: (r) => formatDate(r.date) },
  { key: 'vendor', header: 'Vendor', cell: (r) => r.vendor.name },
  { key: 'lineCount', header: 'Item', className: 'text-right', cell: (r) => r.lineCount },
  { key: 'totalAmount', header: 'Total', sortable: true, className: 'text-right', cell: (r) => formatRupiah(r.totalAmount) },
  { key: 'status', header: 'Status', sortable: true, cell: (r) => <StatusTag value={r.status} labels={PROCUREMENT_STATUS_LABEL} /> },
];

export function ProcurementsPage() {
  return <DocListPage<Row> title="Pengadaan Barang" description="Dokumen pengadaan. Inventaris dan stok baru bertambah setelah penerimaan dikonfirmasi." queryKey="procurements" path="/procurements"
    createTo="/pengadaan/baru" createLabel="Buat pengadaan" createPermission="procurements.create" statusLabels={PROCUREMENT_STATUS_LABEL} columns={columns} searchPlaceholder="Cari nomor atau vendor" emptyTitle="Belum ada pengadaan" />;
}
