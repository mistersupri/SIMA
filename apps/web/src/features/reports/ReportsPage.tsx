import { useMemo } from 'react';
import { useParams } from 'react-router';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Download, FileText, Printer } from 'lucide-react';
import { ASSET_CONDITIONS, ASSET_CONDITION_LABEL, ASSET_STATUSES, ASSET_STATUS_LABEL, DOC_STATUS_LABEL, LOAN_STATUS_LABEL, MAINTENANCE_STATUS_LABEL, MUTATION_STATUS_LABEL, OPNAME_STATUS_LABEL, PROCUREMENT_STATUS_LABEL } from '@sima/shared';
import { api, buildQuery } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { formatDate, formatQty, formatRupiah } from '@/lib/format';
import { useListState } from '@/hooks/use-list-state';
import { optionLabel, useOptions } from '@/hooks/use-options';
import { Button } from '@/components/ui/button';
import { Field, Input, Select } from '@/components/ui/form';
import { Card, ErrorState, PageHeader } from '@/components/ui/misc';
import { DataTable, type Column } from '@/components/ui/data-table';
import { errMsg } from '@/features/docs/common';

interface Col { key: string; header: string; type?: 'text' | 'number' | 'money' | 'date' }
interface Meta { key: string; title: string; description: string; filters: string[]; columns: Col[] }
interface Result { columns: Col[]; summary: { label: string; value: string | number; type?: string }[]; title: string }

const STATUS_BY_REPORT: Record<string, Record<string, string>> = {
  assets: ASSET_STATUS_LABEL, mutations: MUTATION_STATUS_LABEL, loans: LOAN_STATUS_LABEL, maintenances: MAINTENANCE_STATUS_LABEL,
  procurements: PROCUREMENT_STATUS_LABEL, disposals: DOC_STATUS_LABEL, 'stock-opnames': OPNAME_STATUS_LABEL,
};
const cell = (c: Col, v: unknown) => (v === null || v === undefined || v === '' ? <span className="text-muted">-</span> : c.type === 'money' ? formatRupiah(v as number) : c.type === 'number' ? formatQty(v as number) : c.type === 'date' ? formatDate(v as string) : String(v));

export function ReportsPage() {
  const { key = '' } = useParams();
  const { can } = useAuth();
  const metas = useQuery({ queryKey: ['reports-meta'], queryFn: async () => (await api.get<Meta[]>('/reports')).data, staleTime: 300_000 });
  const meta = metas.data?.find((m) => m.key === key);
  return metas.isPending ? <p className="py-16 text-center text-muted">Memuat laporan…</p>
    : metas.error ? <ErrorState message={errMsg(metas.error)} onRetry={() => void metas.refetch()} />
    : !meta ? <ErrorState message="Laporan tidak ditemukan." />
    : <ReportView key={key} meta={meta} canExport={can('reports.export') || (key === 'assets' && can('assets.export')) || (key === 'stocks' && can('stocks.export'))} />;
}

function ReportView({ meta, canExport }: { meta: Meta; canExport: boolean }) {
  const list = useListState({ limit: 20 });
  const s = list.state;
  const categories = useOptions('/categories');
  const locations = useOptions('/locations');
  const units = useOptions('/organizational-units');
  const warehouses = useOptions('/warehouses');
  const has = (f: string) => meta.filters.includes(f);
  const params = useMemo(() => Object.fromEntries(Object.entries(s.filters).filter(([, v]) => v)), [s.filters]);

  const q = useQuery({
    queryKey: ['report', meta.key, s.page, s.limit, params],
    queryFn: ({ signal }) => api.get<unknown[]>(`/reports/${meta.key}${buildQuery({ page: s.page, limit: s.limit, ...params })}`, signal) as Promise<Awaited<ReturnType<typeof api.get<unknown[]>>> & Result>,
    placeholderData: keepPreviousData,
  });
  const result = q.data as unknown as (Result & { data: Record<string, unknown>[]; meta: any }) | undefined;
  const columns: Column<Record<string, unknown>>[] = meta.columns.map((c) => ({ key: c.key, header: c.header, className: c.type === 'number' || c.type === 'money' ? 'text-right' : undefined, cell: (r) => cell(c, r[c.key]) }));
  const exportUrl = (format: 'xlsx' | 'pdf') => `/api/v1/exports/${meta.key}${buildQuery({ format, ...params })}`;
  const sel = (name: string, label: string, options: { v: string; l: string }[]) => (
    <Select aria-label={label} className="w-auto" value={s.filters[name] ?? ''} onChange={(e) => list.setFilter(name, e.target.value)}><option value="">{label}</option>{options.map((o) => <option key={o.v} value={o.v}>{o.l}</option>)}</Select>
  );

  return (
    <>
      <PageHeader title={meta.title} description={meta.description}
        actions={<div className="flex flex-wrap gap-2 print:hidden">
          {canExport && <Button asChild variant="secondary"><a href={exportUrl('xlsx')} download><Download className="size-4" aria-hidden /> Excel</a></Button>}
          {canExport && <Button asChild variant="secondary"><a href={exportUrl('pdf')} download><FileText className="size-4" aria-hidden /> PDF</a></Button>}
          <Button variant="secondary" onClick={() => window.print()}><Printer className="size-4" aria-hidden /> Cetak</Button>
        </div>} />
      <div className="mb-3 flex flex-wrap items-end gap-2 print:hidden">
        {(has('from') || has('to')) && (<>
          <Field label="Dari tanggal">{(p) => <Input {...p} type="date" className="w-auto" value={s.filters.from ?? ''} onChange={(e) => list.setFilter('from', e.target.value)} />}</Field>
          <Field label="Sampai tanggal">{(p) => <Input {...p} type="date" className="w-auto" value={s.filters.to ?? ''} onChange={(e) => list.setFilter('to', e.target.value)} />}</Field>
        </>)}
        {has('year') && <Field label="Tahun">{(p) => <Input {...p} type="number" className="w-28" placeholder="2026" value={s.filters.year ?? ''} onChange={(e) => list.setFilter('year', e.target.value)} />}</Field>}
        {has('categoryId') && sel('categoryId', 'Semua kategori', (categories.data ?? []).map((o) => ({ v: o.id, l: o.name })))}
        {has('locationId') && sel('locationId', 'Semua lokasi', (locations.data ?? []).map((o) => ({ v: o.id, l: optionLabel(o) })))}
        {has('unitId') && sel('unitId', 'Semua unit kerja', (units.data ?? []).map((o) => ({ v: o.id, l: o.name })))}
        {has('warehouseId') && sel('warehouseId', 'Semua gudang', (warehouses.data ?? []).map((o) => ({ v: o.id, l: o.name })))}
        {has('condition') && sel('condition', 'Semua kondisi', ASSET_CONDITIONS.map((c) => ({ v: c, l: ASSET_CONDITION_LABEL[c] })))}
        {has('status') && sel('status', 'Semua status', Object.entries(meta.key === 'assets' ? Object.fromEntries(ASSET_STATUSES.map((a) => [a, ASSET_STATUS_LABEL[a]])) : STATUS_BY_REPORT[meta.key] ?? {}).map(([v, l]) => ({ v, l })))}
        {Object.keys(params).length > 0 && <Button variant="ghost" onClick={() => { for (const k of Object.keys(params)) list.setFilter(k, ''); }}>Reset filter</Button>}
      </div>
      {result?.summary?.length ? (
        <dl className="mb-3 flex flex-wrap gap-3">{result.summary.map((x) => (
          <Card key={x.label} className="min-w-36 px-4 py-2.5"><dt className="text-xs text-muted">{x.label}</dt><dd className="text-lg font-semibold text-navy">{x.type === 'money' ? formatRupiah(x.value as number) : typeof x.value === 'number' ? formatQty(x.value) : x.value}</dd></Card>))}</dl>
      ) : null}
      <DataTable caption={meta.title} columns={columns} rows={result?.data} rowKey={(r) => JSON.stringify(r)} loading={q.isFetching} error={q.error ? errMsg(q.error) : null} onRetry={() => void q.refetch()}
        meta={result?.meta} onPage={list.setPage} onLimit={list.setLimit} empty={{ title: 'Tidak ada data pada filter ini', description: 'Ubah rentang tanggal atau filter lainnya.' }} />
    </>
  );
}
