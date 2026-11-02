import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { MUTATION_STATUS_LABEL } from '@sima/shared';
import { ApiError, api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { formatDate, formatDateTime } from '@/lib/format';
import { Button } from '@/components/ui/button';
import { CodeStamp, ErrorState, PageHeader, Spinner } from '@/components/ui/misc';
import { ConfirmDialog } from '@/components/ui/confirm';
import { ApprovalTimeline, InfoRow, Panel, StatusTag, errMsg, useDocAction, type Timeline } from '@/features/docs/common';

interface Place { unit?: string; location?: string; person?: string | null }
interface Detail {
  id: string; number: string; date: string; reason: string; status: string; createdByName: string; movedAt: string | null; completedAt: string | null; approval: Timeline | null;
  details: { id: string; asset: { id: string; code: string; item: { name: string } }; from: Place; to: Place }[];
}
const place = (p: Place) => [p.location, p.unit, p.person].filter(Boolean).join(' · ') || '-';

export function MutationDetailPage() {
  const { id } = useParams();
  const { can } = useAuth();
  const [confirm, setConfirm] = useState<'cancel' | 'move' | 'complete' | null>(null);
  const q = useQuery({ queryKey: ['mutation', id], queryFn: async () => (await api.get<Detail>(`/mutations/${id}`)).data });
  const act = useDocAction([['mutation'], ['mutations'], ['assets'], ['asset']]);
  if (q.isPending) return <div className="py-16 text-center"><Spinner label="Memuat mutasi…" /></div>;
  if (q.error) return <ErrorState message={q.error instanceof ApiError && q.error.status === 404 ? 'Mutasi tidak ditemukan.' : errMsg(q.error)} onRetry={() => void q.refetch()} />;
  const m = q.data;
  const editable = ['DRAFT', 'REJECTED'].includes(m.status);
  const copy = {
    cancel: ['Batalkan mutasi?', `Mutasi ${m.number} dibatalkan. Lokasi aset tidak berubah.`, 'Batalkan mutasi'],
    move: ['Catat pemindahan dilakukan?', 'Menandai barang sedang dipindahkan. Lokasi di sistem baru berubah setelah dikonfirmasi tiba.', 'Catat pemindahan'],
    complete: ['Konfirmasi mutasi selesai?', `Lokasi, unit, dan penanggung jawab ${m.details.length} aset akan diperbarui dan histori lokasi dicatat. Semua perubahan berhasil atau tidak sama sekali.`, 'Konfirmasi selesai'],
  } as const;

  return (
    <>
      <PageHeader
        title={`Mutasi ${m.number}`} description={`Dibuat oleh ${m.createdByName}`}
        actions={<>
          <StatusTag value={m.status} labels={MUTATION_STATUS_LABEL} />
          {editable && can('mutations.create') && <Button asChild variant="secondary"><Link to={`/mutasi/${m.id}/ubah`}>Ubah</Link></Button>}
          {(editable || m.status === 'APPROVED') && can('mutations.create') && <Button variant="secondary" onClick={() => setConfirm('cancel')}>Batalkan</Button>}
          {editable && can('mutations.submit') && <Button disabled={act.isPending} onClick={() => act.mutate({ path: `/mutations/${m.id}/submit` })}>Ajukan persetujuan</Button>}
          {m.status === 'APPROVED' && can('mutations.complete') && <Button onClick={() => setConfirm('move')}>Catat pemindahan</Button>}
          {m.status === 'IN_TRANSFER' && can('mutations.complete') && <Button onClick={() => setConfirm('complete')}>Konfirmasi selesai</Button>}
        </>}
      />
      <div className="grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <Panel title={`Aset (${m.details.length})`}>
          <div className="-m-4 overflow-x-auto"><table className="w-full min-w-[560px] text-left text-sm">
            <thead><tr className="border-b border-line bg-wash text-muted"><th className="px-4 py-2.5 font-medium">Aset</th><th className="px-4 py-2.5 font-medium">Asal</th><th className="px-4 py-2.5 font-medium">Tujuan</th></tr></thead>
            <tbody>{m.details.map((d) => (<tr key={d.id} className="border-b border-line last:border-0"><td className="px-4 py-3"><Link to={`/aset/${d.asset.id}`} className="hover:underline"><CodeStamp>{d.asset.code}</CodeStamp></Link><span className="mt-1 block">{d.asset.item.name}</span></td><td className="px-4 py-3">{place(d.from)}</td><td className="px-4 py-3 font-medium">{place(d.to)}</td></tr>))}</tbody>
          </table></div>
        </Panel>
        <div className="grid grid-cols-[minmax(0,1fr)] content-start gap-4">
          <Panel title="Informasi"><dl>
            <InfoRow label="Tanggal">{formatDate(m.date)}</InfoRow><InfoRow label="Alasan">{m.reason}</InfoRow>
            <InfoRow label="Dipindahkan">{formatDateTime(m.movedAt)}</InfoRow><InfoRow label="Selesai">{formatDateTime(m.completedAt)}</InfoRow>
          </dl></Panel>
          <Panel title="Persetujuan"><ApprovalTimeline data={m.approval} /></Panel>
        </div>
      </div>
      <ConfirmDialog open={!!confirm} onOpenChange={(o) => !o && setConfirm(null)} title={confirm ? copy[confirm][0] : ''} description={confirm ? copy[confirm][1] : ''} confirmLabel={confirm ? copy[confirm][2] : ''} danger={confirm === 'cancel'}
        onConfirm={async () => { await act.mutateAsync({ path: `/mutations/${m.id}/${confirm}` }); }} />
    </>
  );
}
