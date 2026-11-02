import { useState } from 'react';
import { Link } from 'react-router';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { formatDate, formatQty } from '@/lib/format';
import { CodeStamp } from '@/components/ui/misc';
import type { Column } from '@/components/ui/data-table';
import { ConfirmDialog } from '@/components/ui/confirm';
import { RowMenu } from '@/components/ui/row-menu';
import { DocListPage } from '@/features/docs/DocListPage';
import { StatusTag, errMsg } from '@/features/docs/common';
import { useQueryClient } from '@tanstack/react-query';

interface Row {
  id: string; number: string; receivedDate: string; status: string; receivedById: string;
  procurement: { id: string; number: string; vendor: { name: string } }; warehouse: { name: string } | null;
  details: { quantityReceived: string; item: { name: string; type: 'ASSET' | 'SUPPLY' } }[];
}
const LABELS = { DRAFT: 'Menunggu konfirmasi', CONFIRMED: 'Dikonfirmasi', CANCELLED: 'Dibatalkan' };

export function ReceiptsPage() {
  const { can, user } = useAuth();
  const qc = useQueryClient();
  const [target, setTarget] = useState<{ row: Row; kind: 'confirm' | 'cancel' } | null>(null);

  const columns: Column<Row>[] = [
    { key: 'number', header: 'Nomor', sortable: true, cell: (r) => <CodeStamp>{r.number}</CodeStamp> },
    { key: 'procurement', header: 'Pengadaan', cell: (r) => (<Link to={`/pengadaan/${r.procurement.id}`} className="hover:underline"><CodeStamp>{r.procurement.number}</CodeStamp><span className="block text-xs text-muted">{r.procurement.vendor.name}</span></Link>) },
    { key: 'receivedDate', header: 'Tanggal terima', sortable: true, cell: (r) => formatDate(r.receivedDate) },
    { key: 'lines', header: 'Barang', cell: (r) => (<ul className="text-sm">{r.details.map((d, i) => <li key={i}>{d.item.name}: <span className="font-medium">{formatQty(d.quantityReceived)}</span></li>)}</ul>) },
    { key: 'status', header: 'Status', sortable: true, cell: (r) => <StatusTag value={r.status} labels={LABELS} /> },
    { key: 'actions', header: 'Aksi', className: 'w-16 text-right', cell: (r) => r.status !== 'DRAFT' ? null : (
      <RowMenu label={`Aksi untuk ${r.number}`} items={[
        { label: 'Konfirmasi penerimaan', hidden: !can('goods_receipts.confirm'), onSelect: () => setTarget({ row: r, kind: 'confirm' }) },
        { label: 'Batalkan', danger: true, hidden: !can('goods_receipts.create'), onSelect: () => setTarget({ row: r, kind: 'cancel' }) },
      ]} />
    ) },
  ];

  const row = target?.row;
  const hasAsset = row?.details.some((d) => d.item.type === 'ASSET');
  return (
    <>
      <DocListPage<Row> title="Penerimaan Barang" description="Verifikasi penerimaan oleh petugas lain. Setelah dikonfirmasi, unit aset terdaftar dan stok bertambah." queryKey="receipts" path="/goods-receipts"
        statusLabels={LABELS} columns={columns} searchPlaceholder="Cari nomor penerimaan atau pengadaan" emptyTitle="Belum ada penerimaan" />
      <ConfirmDialog
        open={!!target} onOpenChange={(o) => !o && setTarget(null)}
        title={target?.kind === 'confirm' ? 'Konfirmasi penerimaan?' : 'Batalkan penerimaan?'}
        description={target?.kind === 'confirm'
          ? `${row?.number}: ${hasAsset ? 'unit aset baru akan didaftarkan dengan kode dan QR, ' : ''}stok persediaan akan bertambah. Tindakan ini tidak dapat diulang.${row?.receivedById === user?.id ? ' Anda mencatat penerimaan ini; hanya Super Admin yang dapat memverifikasi sendiri.' : ''}`
          : `${row?.number} dibatalkan. Jumlah pada pengadaan tidak berubah.`}
        confirmLabel={target?.kind === 'confirm' ? 'Konfirmasi' : 'Batalkan penerimaan'} danger={target?.kind === 'cancel'}
        onConfirm={async () => {
          try {
            const r = await api.post(`/goods-receipts/${row!.id}/${target!.kind}`);
            toast.success(r.message);
            await Promise.all(['receipts', 'procurement', 'procurements', 'stocks', 'assets', 'items', 'notifications'].map((k) => qc.invalidateQueries({ queryKey: [k] })));
          } catch (e) { toast.error(errMsg(e)); throw e; }
        }}
      />
    </>
  );
}
