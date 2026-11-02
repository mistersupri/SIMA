import { useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Search } from 'lucide-react';
import { api, buildQuery } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import { useListState } from '@/hooks/use-list-state';
import { Button } from '@/components/ui/button';
import { Field, Input, Select } from '@/components/ui/form';
import { Badge, PageHeader } from '@/components/ui/misc';
import { DataTable, type Column } from '@/components/ui/data-table';
import { Dialog } from '@/components/ui/dialog';
import { errMsg } from '@/features/docs/common';

interface Row { id: string; createdAt: string; user: string; action: string; entityType: string; entityId: string | null; summary: string; before: unknown; after: unknown; ipAddress: string | null }

export function AuditLogPage() {
  const list = useListState({ sortBy: 'createdAt', sortOrder: 'desc' });
  const s = list.state;
  const [detail, setDetail] = useState<Row | null>(null);
  const opts = useQuery({ queryKey: ['audit-options'], queryFn: async () => (await api.get<{ actions: string[]; entities: { key: string; label: string }[] }>('/audit-logs/options')).data, staleTime: 60_000 });
  const q = useQuery({
    queryKey: ['audit', s],
    queryFn: ({ signal }) => api.get<Row[]>(`/audit-logs${buildQuery({ page: s.page, limit: s.limit, search: s.search, sortBy: s.sortBy, sortOrder: s.sortOrder, ...s.filters })}`, signal),
    placeholderData: keepPreviousData,
  });
  const columns: Column<Row>[] = [
    { key: 'createdAt', header: 'Waktu', sortable: true, cell: (r) => <span className="whitespace-nowrap">{formatDateTime(r.createdAt)}</span> },
    { key: 'user', header: 'Pengguna', cell: (r) => r.user },
    { key: 'summary', header: 'Aktivitas', cell: (r) => <span><span className="font-medium">{r.summary}</span>{r.entityId && <span className="block text-xs text-muted">{r.entityId}</span>}</span> },
    { key: 'action', header: 'Aksi', sortable: true, cell: (r) => <Badge>{r.action}</Badge> },
    { key: 'entityType', header: 'Objek', sortable: true, cell: (r) => r.entityType },
    { key: 'ip', header: 'IP', cell: (r) => r.ipAddress ?? '-' },
    { key: 'detail', header: 'Rincian', className: 'text-right', cell: (r) => <Button variant="ghost" size="sm" onClick={() => setDetail(r)}>Lihat</Button> },
  ];
  return (
    <>
      <PageHeader title="Audit Log" description="Catatan perubahan data penting. Hanya dapat dibaca; tidak ada yang dapat mengubah atau menghapusnya." />
      <div className="mb-3 flex flex-wrap items-end gap-2">
        <div className="relative min-w-56 flex-1 sm:max-w-xs">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" aria-hidden />
          <Input aria-label="Cari audit log" placeholder="Cari aksi, objek, atau ID" className="pl-9" value={list.searchInput} onChange={(e) => list.setSearchInput(e.target.value)} />
        </div>
        <Select aria-label="Filter objek" className="w-auto" value={s.filters.entityType ?? ''} onChange={(e) => list.setFilter('entityType', e.target.value)}><option value="">Semua objek</option>{opts.data?.entities.map((e) => <option key={e.key} value={e.key}>{e.label}</option>)}</Select>
        <Select aria-label="Filter aksi" className="w-auto" value={s.filters.action ?? ''} onChange={(e) => list.setFilter('action', e.target.value)}><option value="">Semua aksi</option>{opts.data?.actions.map((a) => <option key={a} value={a}>{a}</option>)}</Select>
        <Field label="Dari">{(p) => <Input {...p} type="date" className="w-auto" value={s.filters.from ?? ''} onChange={(e) => list.setFilter('from', e.target.value)} />}</Field>
        <Field label="Sampai">{(p) => <Input {...p} type="date" className="w-auto" value={s.filters.to ?? ''} onChange={(e) => list.setFilter('to', e.target.value)} />}</Field>
      </div>
      <DataTable caption="Audit log" columns={columns} rows={q.data?.data} rowKey={(r) => r.id} loading={q.isFetching} error={q.error ? errMsg(q.error) : null} onRetry={() => void q.refetch()}
        meta={q.data?.meta} sortBy={s.sortBy} sortOrder={s.sortOrder} onSort={list.toggleSort} onPage={list.setPage} onLimit={list.setLimit} empty={{ title: 'Tidak ada catatan yang cocok', description: 'Ubah filter pencarian.' }} />
      <Dialog open={!!detail} onOpenChange={(o) => !o && setDetail(null)} className="max-w-2xl" title="Rincian perubahan" description={detail ? `${detail.user} ${detail.summary}` : undefined}>
        {detail && (['before', 'after'] as const).map((k) => (
          <section key={k} className="mb-3 last:mb-0"><h3 className="mb-1 text-sm font-semibold">{k === 'before' ? 'Sebelum' : 'Sesudah'}</h3>
            {detail[k] ? <pre className="max-h-64 overflow-auto rounded-control bg-wash p-3 text-xs">{JSON.stringify(detail[k], null, 2)}</pre> : <p className="text-sm text-muted">Tidak ada data.</p>}</section>))}
      </Dialog>
    </>
  );
}
