import { useState } from 'react';
import { Link } from 'react-router';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { Search } from 'lucide-react';
import { toast } from 'sonner';
import { api, buildQuery } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import { useListState } from '@/hooks/use-list-state';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/form';
import { Badge, CodeStamp, ErrorState, PageHeader, Spinner } from '@/components/ui/misc';
import { DataTable, type Column } from '@/components/ui/data-table';
import { Dialog } from '@/components/ui/dialog';
import { ApprovalTimeline, DecisionDialog, errMsg, type Timeline } from '@/features/docs/common';

interface Row { id: string; entityLabel: string; documentNumber: string; title: string; status: string; requestedBy: string; submittedAt: string; completedAt: string | null; path: string; canDecide: boolean; currentRole: string | null }
interface Detail extends Row { actions: Timeline['actions'] }

const STATUS = { PENDING: ['Menunggu', 'warning'], APPROVED: ['Disetujui', 'success'], REJECTED: ['Ditolak', 'danger'], CANCELLED: ['Ditarik', 'neutral'] } as const;

function ReviewDialog({ id, onClose }: { id: string | null; onClose: () => void }) {
  const qc = useQueryClient();
  const [mode, setMode] = useState<'approve' | 'reject' | null>(null);
  const q = useQuery({ queryKey: ['approval', id], enabled: !!id, queryFn: async () => (await api.get<Detail>(`/approvals/${id}`)).data });
  const d = q.data;
  const timeline: Timeline | null = d ? { status: d.status, requestedBy: d.requestedBy, submittedAt: d.submittedAt, completedAt: d.completedAt, steps: [], actions: d.actions } : null;
  return (
    <>
      <Dialog open={!!id} onOpenChange={(o) => !o && onClose()} title={d ? `${d.entityLabel} ${d.documentNumber}` : 'Tinjau persetujuan'} description={d?.title} className="max-w-xl"
        footer={d?.canDecide ? <><Button variant="danger" onClick={() => setMode('reject')}>Tolak</Button><Button onClick={() => setMode('approve')}>Setujui</Button></> : undefined}>
        {q.isPending && <div className="py-6 text-center"><Spinner /></div>}
        {q.error && <ErrorState message={errMsg(q.error)} onRetry={() => void q.refetch()} />}
        {d && (
          <div className="flex flex-col gap-4">
            <p className="text-sm">Diajukan oleh <span className="font-medium">{d.requestedBy}</span> pada {formatDateTime(d.submittedAt)}.</p>
            <Button asChild variant="secondary" className="self-start"><Link to={d.path} onClick={onClose}>Buka dokumen lengkap</Link></Button>
            <ApprovalTimeline data={timeline} />
            {!d.canDecide && d.status === 'PENDING' && <p className="rounded-control bg-wash px-3 py-2 text-sm text-muted">Anda tidak dapat memutuskan dokumen ini (bukan kewenangan Anda, atau Anda yang mengajukannya).</p>}
          </div>
        )}
      </Dialog>
      <DecisionDialog mode={mode} onClose={() => setMode(null)} onSubmit={async (note) => {
        await api.post(`/approvals/${id}/${mode}`, { note });
        toast.success(mode === 'approve' ? 'Dokumen disetujui' : 'Dokumen ditolak');
        await Promise.all(['approvals', 'approval', 'procurement', 'mutation', 'loan', 'adjustments', 'notifications'].map((k) => qc.invalidateQueries({ queryKey: [k] })));
        onClose();
      }} />
    </>
  );
}

export function ApprovalsPage({ mode }: { mode: 'pending' | 'history' }) {
  const list = useListState({ sortBy: mode === 'history' ? 'completedAt' : 'submittedAt', sortOrder: mode === 'history' ? 'desc' : 'asc' });
  const [review, setReview] = useState<string | null>(null);
  const s = list.state;
  const query = useQuery({
    queryKey: ['approvals', mode, s],
    queryFn: ({ signal }) => api.get<Row[]>(`/approvals${mode === 'history' ? '/history' : ''}${buildQuery({ page: s.page, limit: s.limit, search: s.search, sortBy: s.sortBy, sortOrder: s.sortOrder })}`, signal),
    placeholderData: keepPreviousData,
    refetchInterval: mode === 'pending' ? 60_000 : false,
  });
  const columns: Column<Row>[] = [
    { key: 'documentNumber', header: 'Dokumen', cell: (r) => (<div><CodeStamp>{r.documentNumber}</CodeStamp><div className="mt-1 text-xs text-muted">{r.entityLabel}</div></div>) },
    { key: 'title', header: 'Ringkasan', cell: (r) => <span className="line-clamp-2">{r.title}</span> },
    { key: 'requestedBy', header: 'Pengaju', cell: (r) => r.requestedBy },
    { key: 'submittedAt', header: mode === 'history' ? 'Diputuskan' : 'Diajukan', sortable: true, cell: (r) => formatDateTime(mode === 'history' ? r.completedAt : r.submittedAt) },
    ...(mode === 'history' ? [{ key: 'status', header: 'Hasil', cell: (r: Row) => <Badge tone={STATUS[r.status as keyof typeof STATUS]?.[1] ?? 'neutral'}>{STATUS[r.status as keyof typeof STATUS]?.[0] ?? r.status}</Badge> }] : []),
    { key: 'actions', header: 'Aksi', className: 'text-right', cell: (r) => <Button variant={r.canDecide ? 'primary' : 'secondary'} size="sm" onClick={() => setReview(r.id)}>{r.canDecide ? 'Tinjau' : 'Lihat'}</Button> },
  ];
  return (
    <>
      <PageHeader title={mode === 'pending' ? 'Menunggu Persetujuan' : 'Riwayat Persetujuan'} description={mode === 'pending' ? 'Dokumen yang menunggu keputusan Anda. Dokumen yang Anda buat sendiri tidak muncul di sini.' : 'Seluruh keputusan persetujuan yang sudah final.'} />
      <div className="relative mb-3 max-w-xs">
        <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" aria-hidden />
        <Input aria-label="Cari dokumen" placeholder="Cari nomor atau ringkasan" className="pl-9" value={list.searchInput} onChange={(e) => list.setSearchInput(e.target.value)} />
      </div>
      <DataTable caption="Daftar persetujuan" columns={columns} rows={query.data?.data} rowKey={(r) => r.id} loading={query.isFetching} error={query.error ? errMsg(query.error) : null} onRetry={() => void query.refetch()}
        meta={query.data?.meta} sortBy={s.sortBy} sortOrder={s.sortOrder} onSort={list.toggleSort} onPage={list.setPage} onLimit={list.setLimit}
        empty={{ title: mode === 'pending' ? 'Tidak ada dokumen yang menunggu persetujuan Anda' : 'Belum ada keputusan', description: mode === 'pending' ? 'Dokumen baru akan muncul di sini dan Anda akan menerima notifikasi.' : undefined }} />
      <ReviewDialog key={review} id={review} onClose={() => setReview(null)} />
    </>
  );
}
