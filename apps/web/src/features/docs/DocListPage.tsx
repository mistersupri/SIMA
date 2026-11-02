import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Plus, Search } from 'lucide-react';
import { api, buildQuery } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useListState } from '@/hooks/use-list-state';
import { Button } from '@/components/ui/button';
import { Input, Select } from '@/components/ui/form';
import { PageHeader } from '@/components/ui/misc';
import { DataTable, type Column } from '@/components/ui/data-table';
import { errMsg } from './common';

interface Props<T extends { id: string }> {
  title: string;
  description: string;
  queryKey: string;
  path: string;
  createTo?: string;
  createLabel?: string;
  createPermission?: string;
  statusLabels: Record<string, string>;
  columns: Column<T>[];
  searchPlaceholder: string;
  emptyTitle: string;
  extraActions?: ReactNode;
  /** Parameter tetap pada setiap permintaan (misalnya history=true untuk halaman riwayat). */
  fixedParams?: Record<string, string>;
  hideStatusFilter?: boolean;
}

/** Halaman daftar dokumen transaksi: pencarian, filter status, sort, dan paginasi dari server. */
export function DocListPage<T extends { id: string }>(p: Props<T>) {
  const { can } = useAuth();
  const list = useListState({ sortBy: 'createdAt', sortOrder: 'desc' });
  const s = list.state;
  const query = useQuery({
    queryKey: [p.queryKey, s, p.fixedParams],
    queryFn: ({ signal }) => api.get<T[]>(`${p.path}${buildQuery({ page: s.page, limit: s.limit, search: s.search, sortBy: s.sortBy, sortOrder: s.sortOrder, ...s.filters, ...p.fixedParams })}`, signal),
    placeholderData: keepPreviousData,
  });
  const filtered = !!s.search || Object.values(s.filters).some(Boolean);
  return (
    <>
      <PageHeader
        title={p.title} description={p.description}
        actions={<>{p.extraActions}{p.createTo && (!p.createPermission || can(p.createPermission)) && <Button asChild><Link to={p.createTo}><Plus className="size-4" aria-hidden /> {p.createLabel}</Link></Button>}</>}
      />
      <div className="mb-3 flex flex-wrap gap-2">
        <div className="relative min-w-56 flex-1 sm:max-w-xs">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" aria-hidden />
          <Input aria-label="Cari dokumen" placeholder={p.searchPlaceholder} className="pl-9" value={list.searchInput} onChange={(e) => list.setSearchInput(e.target.value)} />
        </div>
        {!p.hideStatusFilter && <Select aria-label="Filter status" className="w-auto" value={s.filters.status ?? ''} onChange={(e) => list.setFilter('status', e.target.value)}>
          <option value="">Semua status</option>
          {Object.entries(p.statusLabels).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </Select>}
      </div>
      <DataTable
        caption={p.title} columns={p.columns} rows={query.data?.data} rowKey={(r) => r.id}
        loading={query.isFetching} error={query.error ? errMsg(query.error) : null} onRetry={() => void query.refetch()}
        meta={query.data?.meta} sortBy={s.sortBy} sortOrder={s.sortOrder} onSort={list.toggleSort} onPage={list.setPage} onLimit={list.setLimit}
        empty={{ title: filtered ? 'Tidak ada dokumen yang cocok' : p.emptyTitle, description: filtered ? 'Ubah kata kunci atau filter.' : undefined }}
      />
    </>
  );
}
