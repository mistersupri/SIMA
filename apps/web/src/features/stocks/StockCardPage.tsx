import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react';
import { STOCK_TX_LABEL } from '@sima/shared';
import { ApiError, api, buildQuery } from '@/lib/api';
import { formatDate, formatQty } from '@/lib/format';
import { useOptions } from '@/hooks/use-options';
import { Badge, Card, CodeStamp, ErrorState, PageHeader, Spinner } from '@/components/ui/misc';
import { Field, Input, Select } from '@/components/ui/form';
import { DataTable, type Column } from '@/components/ui/data-table';

interface ItemStock { id: string; code: string; name: string; unit: string; minStock: string; quantity: string; belowMin: boolean; balances: { warehouseId: string; warehouse: string; quantity: string }[] }
interface CardRow { id: string; date: string; number: string; type: keyof typeof STOCK_TX_LABEL; notes: string | null; in: string; out: string; balance: string }

export function StockCardPage() {
  const { itemId } = useParams();
  const warehouses = useOptions('/warehouses');
  const [warehouseId, setWarehouseId] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(50);

  const item = useQuery({ queryKey: ['stock-item', itemId], queryFn: async () => (await api.get<ItemStock>(`/stocks/${itemId}`)).data });
  const wh = warehouseId || item.data?.balances[0]?.warehouseId || warehouses.data?.[0]?.id || '';
  const card = useQuery({
    queryKey: ['stock-card', itemId, wh, from, to, page, limit],
    enabled: !!wh,
    queryFn: ({ signal }) => api.get<CardRow[]>(`/stocks/${itemId}/card${buildQuery({ warehouseId: wh, from, to, page, limit })}`, signal) as Promise<Awaited<ReturnType<typeof api.get<CardRow[]>>> & { openingBalance?: string }>,
    placeholderData: keepPreviousData,
  });

  if (item.isPending) return <div className="py-16 text-center"><Spinner label="Memuat barang…" /></div>;
  if (item.error) return <ErrorState message={item.error instanceof ApiError && item.error.status === 404 ? 'Barang persediaan tidak ditemukan.' : item.error.message} onRetry={() => void item.refetch()} />;
  const it = item.data;
  const opening = (card.data as unknown as { openingBalance?: string } | undefined)?.openingBalance;

  const columns: Column<CardRow>[] = [
    { key: 'date', header: 'Tanggal', cell: (r) => formatDate(r.date) },
    { key: 'number', header: 'Nomor', cell: (r) => <CodeStamp>{r.number}</CodeStamp> },
    { key: 'type', header: 'Transaksi', cell: (r) => <Badge tone={r.type === 'OUT' ? 'warning' : 'success'}>{STOCK_TX_LABEL[r.type]}</Badge> },
    { key: 'notes', header: 'Keterangan', cell: (r) => r.notes ?? <span className="text-muted">-</span> },
    { key: 'in', header: 'Masuk', className: 'text-right', cell: (r) => (Number(r.in) ? formatQty(r.in) : <span className="text-muted">-</span>) },
    { key: 'out', header: 'Keluar', className: 'text-right', cell: (r) => (Number(r.out) ? formatQty(r.out) : <span className="text-muted">-</span>) },
    { key: 'balance', header: 'Saldo', className: 'text-right font-medium', cell: (r) => formatQty(r.balance) },
  ];

  return (
    <>
      <Link to="/persediaan" className="mb-3 inline-flex min-h-11 items-center gap-1.5 text-sm text-muted hover:text-ink sm:min-h-8"><ArrowLeft className="size-4" aria-hidden /> Persediaan</Link>
      <PageHeader title={`Kartu stok: ${it.name}`} description={`Kode ${it.code}. Saldo total ${formatQty(it.quantity)} ${it.unit}${it.belowMin ? ' (di bawah minimum)' : ''}.`} />
      <Card className="mb-4 p-4">
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Gudang">
            {(p) => (<Select {...p} value={wh} onChange={(e) => { setWarehouseId(e.target.value); setPage(1); }}>{warehouses.data?.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</Select>)}
          </Field>
          <Field label="Dari tanggal">{(p) => <Input {...p} type="date" value={from} onChange={(e) => { setFrom(e.target.value); setPage(1); }} />}</Field>
          <Field label="Sampai tanggal">{(p) => <Input {...p} type="date" value={to} onChange={(e) => { setTo(e.target.value); setPage(1); }} />}</Field>
        </div>
        {from && <p className="mt-3 text-sm text-muted">Saldo pembuka sebelum {formatDate(from)}: <span className="font-medium text-ink">{formatQty(opening ?? '0')} {it.unit}</span></p>}
      </Card>
      <DataTable
        caption={`Kartu stok ${it.name}`} columns={columns} rows={card.data?.data} rowKey={(r) => r.id}
        loading={card.isFetching} error={card.error ? card.error.message : null} onRetry={() => void card.refetch()}
        meta={card.data?.meta} onPage={setPage} onLimit={(n) => { setLimit(n); setPage(1); }}
        empty={{ title: 'Belum ada transaksi pada gudang dan periode ini', description: 'Ubah gudang atau rentang tanggal.' }}
      />
    </>
  );
}
