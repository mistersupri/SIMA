import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { ASSET_CONDITIONS, ASSET_CONDITION_LABEL, MAINTENANCE_STATUS_LABEL, MAINTENANCE_TYPE_LABEL, maintenanceCompleteSchema } from '@sima/shared';
import { ApiError, api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { formatDate, formatDateTime, formatRupiah } from '@/lib/format';
import { Button } from '@/components/ui/button';
import { Field, Input, Select, Textarea } from '@/components/ui/form';
import { CodeStamp, ErrorState, PageHeader, Spinner } from '@/components/ui/misc';
import { Dialog } from '@/components/ui/dialog';
import { ConfirmDialog } from '@/components/ui/confirm';
import { ConditionBadge, StatusBadge } from '@/features/assets/labels';
import { ApprovalTimeline, InfoRow, Panel, StatusTag, errMsg, useDocAction, type Timeline } from '@/features/docs/common';

interface Detail {
  id: string; number: string; date: string; type: keyof typeof MAINTENANCE_TYPE_LABEL; damageDescription: string; actionTaken: string | null; cost: string; status: string; performerName: string | null;
  startedAt: string | null; completedAt: string | null; resultingCondition: keyof typeof ASSET_CONDITION_LABEL | null; createdByName: string; approval: Timeline | null;
  vendor: { name: string } | null; asset: { id: string; code: string; status: any; condition: keyof typeof ASSET_CONDITION_LABEL; item: { name: string }; location: { name: string } };
}

function CompleteDialog({ m, onClose }: { m: Detail; onClose: () => void }) {
  const act = useDocAction([['maintenance'], ['maintenances'], ['maintenances-history'], ['asset'], ['assets']]);
  const { register, handleSubmit, setError, formState: { errors } } = useForm<Record<string, any>>({ resolver: zodResolver(maintenanceCompleteSchema as never), defaultValues: { actionTaken: '', cost: 0, resultingCondition: 'GOOD' } });
  const err = (k: string) => errors[k]?.message as string | undefined;
  const submit = handleSubmit(async (v) => {
    try { await act.mutateAsync({ path: `/maintenances/${m.id}/complete`, body: v }); onClose(); }
    catch (e) { if (e instanceof ApiError && e.errors?.length) e.errors.forEach((fe) => setError(fe.field, { message: fe.message })); }
  });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title="Selesaikan perbaikan" description="Aset kembali tersedia dengan kondisi hasil perbaikan."
      footer={<><Button variant="secondary" onClick={onClose}>Batal</Button><Button type="submit" form="complete-form" disabled={act.isPending}>{act.isPending ? 'Menyimpan…' : 'Selesaikan'}</Button></>}>
      <form id="complete-form" onSubmit={submit} noValidate className="flex flex-col gap-4">
        <Field label="Tindakan perbaikan" error={err('actionTaken')} required>{(p) => <Textarea {...p} rows={3} {...register('actionTaken')} />}</Field>
        <Field label="Biaya (Rp)" error={err('cost')}>{(p) => <Input {...p} type="number" min={0} {...register('cost')} />}</Field>
        <Field label="Kondisi setelah perbaikan" error={err('resultingCondition')} required>{(p) => (<Select {...p} {...register('resultingCondition')}>{ASSET_CONDITIONS.map((c) => <option key={c} value={c}>{ASSET_CONDITION_LABEL[c]}</option>)}</Select>)}</Field>
      </form>
    </Dialog>
  );
}

export function MaintenanceDetailPage() {
  const { id } = useParams();
  const { can } = useAuth();
  const [confirm, setConfirm] = useState<'cancel' | 'start' | null>(null);
  const [completing, setCompleting] = useState(false);
  const q = useQuery({ queryKey: ['maintenance', id], queryFn: async () => (await api.get<Detail>(`/maintenances/${id}`)).data });
  const act = useDocAction([['maintenance'], ['maintenances'], ['maintenances-history'], ['asset'], ['assets']]);
  if (q.isPending) return <div className="py-16 text-center"><Spinner label="Memuat pemeliharaan…" /></div>;
  if (q.error) return <ErrorState message={q.error instanceof ApiError && q.error.status === 404 ? 'Pemeliharaan tidak ditemukan.' : errMsg(q.error)} onRetry={() => void q.refetch()} />;
  const m = q.data;
  const editable = ['REPORTED', 'REJECTED'].includes(m.status);
  const copy = { cancel: ['Batalkan pemeliharaan?', `${m.number} dibatalkan.`, 'Batalkan'], start: ['Mulai perbaikan?', `${m.asset.code} berstatus dalam perbaikan dan tidak dapat dipinjam atau dimutasi sampai perbaikan selesai.`, 'Mulai perbaikan'] } as const;

  return (
    <>
      <PageHeader title={`Pemeliharaan ${m.number}`} description={`Dilaporkan oleh ${m.createdByName}`}
        actions={<>
          <StatusTag value={m.status} labels={MAINTENANCE_STATUS_LABEL} />
          {editable && can('maintenances.create') && <Button asChild variant="secondary"><Link to={`/pemeliharaan/${m.id}/ubah`}>Ubah</Link></Button>}
          {(editable || m.status === 'APPROVED') && can('maintenances.create') && <Button variant="secondary" onClick={() => setConfirm('cancel')}>Batalkan</Button>}
          {editable && can('maintenances.submit') && <Button disabled={act.isPending} onClick={() => act.mutate({ path: `/maintenances/${m.id}/submit` })}>Ajukan persetujuan</Button>}
          {m.status === 'APPROVED' && can('maintenances.complete') && <Button onClick={() => setConfirm('start')}>Mulai perbaikan</Button>}
          {m.status === 'IN_PROGRESS' && can('maintenances.complete') && <Button onClick={() => setCompleting(true)}>Selesaikan perbaikan</Button>}
        </>} />
      <div className="grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="grid grid-cols-[minmax(0,1fr)] content-start gap-4">
          <Panel title="Aset"><dl>
            <InfoRow label="Kode"><Link to={`/aset/${m.asset.id}`} className="hover:underline"><CodeStamp>{m.asset.code}</CodeStamp></Link></InfoRow>
            <InfoRow label="Barang">{m.asset.item.name}</InfoRow><InfoRow label="Lokasi">{m.asset.location.name}</InfoRow>
            <InfoRow label="Status sekarang"><span className="inline-flex gap-1.5"><StatusBadge value={m.asset.status} /><ConditionBadge value={m.asset.condition} /></span></InfoRow>
          </dl></Panel>
          <Panel title="Pekerjaan"><dl>
            <InfoRow label="Jenis">{MAINTENANCE_TYPE_LABEL[m.type]}</InfoRow><InfoRow label="Keluhan">{m.damageDescription}</InfoRow>
            <InfoRow label="Pelaksana">{[m.performerName, m.vendor?.name].filter(Boolean).join(' · ') || '-'}</InfoRow>
            <InfoRow label="Tindakan">{m.actionTaken ?? '-'}</InfoRow><InfoRow label="Biaya">{formatRupiah(m.cost)}</InfoRow>
            <InfoRow label="Kondisi akhir">{m.resultingCondition ? <ConditionBadge value={m.resultingCondition} /> : '-'}</InfoRow>
          </dl></Panel>
        </div>
        <div className="grid grid-cols-[minmax(0,1fr)] content-start gap-4">
          <Panel title="Waktu"><dl><InfoRow label="Tanggal laporan">{formatDate(m.date)}</InfoRow><InfoRow label="Mulai">{formatDateTime(m.startedAt)}</InfoRow><InfoRow label="Selesai">{formatDateTime(m.completedAt)}</InfoRow></dl></Panel>
          <Panel title="Persetujuan"><ApprovalTimeline data={m.approval} /></Panel>
        </div>
      </div>
      {completing && <CompleteDialog m={m} onClose={() => setCompleting(false)} />}
      <ConfirmDialog open={!!confirm} onOpenChange={(o) => !o && setConfirm(null)} title={confirm ? copy[confirm][0] : ''} description={confirm ? copy[confirm][1] : ''} confirmLabel={confirm ? copy[confirm][2] : ''} danger={confirm === 'cancel'}
        onConfirm={async () => { await act.mutateAsync({ path: `/maintenances/${m.id}/${confirm}` }); }} />
    </>
  );
}
