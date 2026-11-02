import { Link } from 'react-router';
import { LOAN_STATUS_LABEL } from '@sima/shared';
import { formatDate } from '@/lib/format';
import { CodeStamp } from '@/components/ui/misc';
import type { Column } from '@/components/ui/data-table';
import { DocListPage } from '@/features/docs/DocListPage';
import { StatusTag } from '@/features/docs/common';

interface Row { id: string; number: string; loanDate: string; expectedReturnDate: string; purpose: string; status: string; displayStatus: string; borrower: { name: string }; assetCount: number }
const columns: Column<Row>[] = [
  { key: 'number', header: 'Nomor', sortable: true, cell: (r) => <Link to={`/peminjaman/${r.id}`} className="hover:underline"><CodeStamp>{r.number}</CodeStamp></Link> },
  { key: 'borrower', header: 'Peminjam', cell: (r) => (<div><div className="font-medium">{r.borrower.name}</div><div className="line-clamp-1 text-xs text-muted">{r.purpose}</div></div>) },
  { key: 'loanDate', header: 'Tanggal pinjam', sortable: true, cell: (r) => formatDate(r.loanDate) },
  { key: 'expectedReturnDate', header: 'Rencana kembali', sortable: true, cell: (r) => formatDate(r.expectedReturnDate) },
  { key: 'assetCount', header: 'Aset', className: 'text-right', cell: (r) => r.assetCount },
  { key: 'status', header: 'Status', sortable: true, cell: (r) => <StatusTag value={r.displayStatus} labels={LOAN_STATUS_LABEL} /> },
];

export function LoansPage() {
  return <DocListPage<Row> title="Peminjaman" description="Peminjaman aset dengan persetujuan. Aset yang sedang dipinjam atau diperbaiki tidak dapat dipinjam lagi." queryKey="loans" path="/loans"
    createTo="/peminjaman/baru" createLabel="Buat peminjaman" createPermission="loans.create" statusLabels={LOAN_STATUS_LABEL} columns={columns} searchPlaceholder="Cari nomor, peminjam, atau kode aset" emptyTitle="Belum ada peminjaman" />;
}
