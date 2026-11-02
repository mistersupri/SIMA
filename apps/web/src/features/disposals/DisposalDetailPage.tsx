import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { DISPOSAL_METHOD_LABEL, DOC_STATUS_LABEL } from '@sima/shared';
import { ApiError, api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { formatDate, formatDateTime } from '@/lib/format';
import { Button } from '@/components/ui/button';
import { CodeStamp, ErrorState, PageHeader, Spinner } from '@/components/ui/misc';
import { ConfirmDialog } from '@/components/ui/confirm';
import { ConditionBadge, StatusBadge } from '@/features/assets/labels';
import { ApprovalTimeline, InfoRow, Panel, StatusTag, errMsg, useDocAction, type Timeline } from '@/features/docs/common';

interface Detail {
  id: string; number: string; date: string; reason: string; method: keyof typeof DISPOSAL_METHOD_LABEL; status: string; createdByName: string; completedAt: string | null; approval: Timeline | null;
  details: { id: string; notes: string | null; lastCondition: any; asset: { id: string; code: string; status: any; disposedAt: string | null; item: { name: string }; location: { name: string } } }[];
}

export function DisposalDetailPage() {
  const { id } = useParams();
  const { can } = useAuth();
  const [confirm, setConfirm] = useState<'cancel' | 'complete' | null>(null);
  const q = useQuery({ queryKey: ['disposal', id], queryFn: async () => (await api.get<Detail>(`/disposals/${id}`)).data });
  const act = useDocAction([['disposal'], ['disposals'], ['disposals-history'], ['assets'], ['asset']]);
  if (q.isPending) return <div className="py-16 text-center"><Spinner label="Memuat pengajuan…" /></div>;
  if (q.error) return <ErrorState message={q.error instanceof ApiError && q.error.status === 404 ? 'Pengajuan tidak ditemukan.' : errMsg(q.error)} onRetry={() => void q.refetch()} />;
  const d = q.data;
  const editable = ['DRAFT', 'REJECTED'].includes(d.status);
  const copy = {
    cancel: ['Batalkan pengajuan?', `${d.number} dibatalkan. Status aset tidak berubah.`, 'Batalkan pengajuan'],
    complete: ['Finalisasi penghapusan?', `${d.details.length} aset berstatus dihapuskan dan tidak dapat dipinjam, dimutasi, atau diubah lagi. Histori dan QR tetap tersimpan. Tindakan ini tidak dapat dibatalkan.`, 'Finalisasi'],
  } as const;
  return (
    <>
      <PageHeader title={`Penghapusan ${d.number}`} description={`Dibuat oleh ${d.createdByName}`}
        actions={<>
          <StatusTag value={d.status} labels={DOC_STATUS_LABEL} />
          {editable && can('disposals.create') && <Button asChild variant="secondary"><Link to={`/penghapusan/${d.id}/ubah`}>Ubah</Link></Button>}
          {(editable || d.status === 'APPROVED') && can('disposals.create') && <Button variant="secondary" onClick={() => setConfirm('cancel')}>Batalkan</Button>}
          {editable && can('disposals.submit') && <Button disabled={act.isPending} onClick={() => act.mutate({ path: `/disposals/${d.id}/submit` })}>Ajukan persetujuan</Button>}
          {d.status === 'APPROVED' && can('disposals.complete') && <Button variant="danger" onClick={() => setConfirm('complete')}>Finalisasi penghapusan</Button>}
        </>} />
      <div className="grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <Panel title={`Aset (${d.details.length})`}>
          <div className="-m-4 overflow-x-auto"><table className="w-full min-w-[560px] text-left text-sm">
            <thead><tr className="border-b border-line bg-wash text-muted"><th className="px-4 py-2.5 font-medium">Aset</th><th className="px-4 py-2.5 font-medium">Kondisi terakhir</th><th className="px-4 py-2.5 font-medium">Status</th><th className="px-4 py-2.5 font-medium">Catatan</th></tr></thead>
            <tbody>{d.details.map((x) => (
              <tr key={x.id} className="border-b border-line last:border-0">
                <td className="px-4 py-3"><Link to={`/aset/${x.asset.id}`} className="hover:underline"><CodeStamp>{x.asset.code}</CodeStamp></Link><span className="mt-1 block">{x.asset.item.name}</span></td>
                <td className="px-4 py-3"><ConditionBadge value={x.lastCondition} /></td><td className="px-4 py-3"><StatusBadge value={x.asset.status} /></td><td className="px-4 py-3">{x.notes ?? '-'}</td>
              </tr>))}</tbody>
          </table></div>
        </Panel>
        <div className="grid grid-cols-[minmax(0,1fr)] content-start gap-4">
          <Panel title="Informasi"><dl>
            <InfoRow label="Tanggal">{formatDate(d.date)}</InfoRow><InfoRow label="Cara">{DISPOSAL_METHOD_LABEL[d.method]}</InfoRow><InfoRow label="Alasan">{d.reason}</InfoRow><InfoRow label="Difinalisasi">{formatDateTime(d.completedAt)}</InfoRow>
          </dl></Panel>
          <Panel title="Persetujuan"><ApprovalTimeline data={d.approval} /></Panel>
        </div>
      </div>
      <ConfirmDialog open={!!confirm} onOpenChange={(o) => !o && setConfirm(null)} title={confirm ? copy[confirm][0] : ''} description={confirm ? copy[confirm][1] : ''} confirmLabel={confirm ? copy[confirm][2] : ''} danger
        onConfirm={async () => { await act.mutateAsync({ path: `/disposals/${d.id}/${confirm}` }); }} />
    </>
  );
}
