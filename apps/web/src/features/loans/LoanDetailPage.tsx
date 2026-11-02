import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { ASSET_CONDITIONS, ASSET_CONDITION_LABEL, LOAN_STATUS_LABEL, loanReturnSchema } from '@sima/shared';
import { ApiError, api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { formatDate, formatDateTime } from '@/lib/format';
import { Button } from '@/components/ui/button';
import { Checkbox, Field, Input, Select } from '@/components/ui/form';
import { CodeStamp, ErrorState, PageHeader, Spinner } from '@/components/ui/misc';
import { Dialog } from '@/components/ui/dialog';
import { ConfirmDialog } from '@/components/ui/confirm';
import { ConditionBadge } from '@/features/assets/labels';
import { ApprovalTimeline, InfoRow, Panel, StatusTag, errMsg, useDocAction, type Timeline } from '@/features/docs/common';

interface Detail {
  id: string; number: string; status: string; displayStatus: string; loanDate: string; expectedReturnDate: string; purpose: string; createdByName: string; handedOverAt: string | null; returnedAt: string | null;
  borrower: { name: string; position: string | null }; approval: Timeline | null;
  details: { id: string; returnedAt: string | null; conditionBefore: keyof typeof ASSET_CONDITION_LABEL; conditionAfter: keyof typeof ASSET_CONDITION_LABEL | null; returnNotes: string | null; asset: { id: string; code: string; item: { name: string }; location: { name: string } } }[];
}

function ReturnDialog({ loan, onClose }: { loan: Detail; onClose: () => void }) {
  const act = useDocAction([['loan'], ['loans'], ['assets'], ['asset']]);
  const open = loan.details.filter((d) => !d.returnedAt);
  const [chosen, setChosen] = useState<Set<string>>(new Set(open.map((d) => d.asset.id)));
  const { register, handleSubmit, setError, formState: { errors } } = useForm<Record<string, any>>({
    defaultValues: Object.fromEntries(open.map((d) => [d.asset.id, { conditionAfter: d.conditionBefore, notes: '' }])),
  });
  const submit = handleSubmit(async (v) => {
    const returns = open.filter((d) => chosen.has(d.asset.id)).map((d) => ({ assetId: d.asset.id, conditionAfter: v[d.asset.id].conditionAfter, notes: v[d.asset.id].notes }));
    const parsed = loanReturnSchema.safeParse({ returns });
    if (!parsed.success) { setError('root', { message: parsed.error.issues[0]!.message }); return; }
    try { await act.mutateAsync({ path: `/loans/${loan.id}/return`, body: parsed.data }); onClose(); }
    catch (e) { setError('root', { message: e instanceof ApiError ? e.message : 'Terjadi kesalahan' }); }
  });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} className="max-w-xl" title="Proses pengembalian" description="Periksa fisik aset dan catat kondisi aktual saat dikembalikan."
      footer={<><Button variant="secondary" onClick={onClose}>Batal</Button><Button type="submit" form="return-form" disabled={act.isPending}>{act.isPending ? 'Menyimpan…' : 'Catat pengembalian'}</Button></>}>
      <form id="return-form" onSubmit={submit} noValidate className="flex flex-col gap-3">
        {errors.root && <p role="alert" className="text-sm text-danger-ink">{errors.root.message}</p>}
        {open.map((d) => (
          <div key={d.id} className="rounded-control border border-line p-3">
            <Checkbox label={<span><span className="code-stamp">{d.asset.code}</span> <span className="ml-1 font-medium">{d.asset.item.name}</span></span>} checked={chosen.has(d.asset.id)}
              onChange={(e) => setChosen((s) => { const n = new Set(s); if (e.target.checked) n.add(d.asset.id); else n.delete(d.asset.id); return n; })} />
            {chosen.has(d.asset.id) && (
              <div className="mt-2 grid gap-3 sm:grid-cols-2">
                <Field label="Kondisi saat kembali" required>{(p) => (<Select {...p} {...register(`${d.asset.id}.conditionAfter`)}>{ASSET_CONDITIONS.map((c) => <option key={c} value={c}>{ASSET_CONDITION_LABEL[c]}</option>)}</Select>)}</Field>
                <Field label="Catatan">{(p) => <Input {...p} {...register(`${d.asset.id}.notes`)} />}</Field>
              </div>
            )}
          </div>
        ))}
      </form>
    </Dialog>
  );
}

export function LoanDetailPage() {
  const { id } = useParams();
  const { can } = useAuth();
  const [confirm, setConfirm] = useState<'cancel' | 'handover' | null>(null);
  const [returning, setReturning] = useState(false);
  const q = useQuery({ queryKey: ['loan', id], queryFn: async () => (await api.get<Detail>(`/loans/${id}`)).data });
  const act = useDocAction([['loan'], ['loans'], ['assets'], ['asset']]);
  if (q.isPending) return <div className="py-16 text-center"><Spinner label="Memuat peminjaman…" /></div>;
  if (q.error) return <ErrorState message={q.error instanceof ApiError && q.error.status === 404 ? 'Peminjaman tidak ditemukan.' : errMsg(q.error)} onRetry={() => void q.refetch()} />;
  const l = q.data;
  const editable = ['DRAFT', 'REJECTED'].includes(l.status);
  const running = ['ACTIVE', 'OVERDUE'].includes(l.displayStatus) || l.status === 'OVERDUE';

  return (
    <>
      <PageHeader
        title={`Peminjaman ${l.number}`} description={`Dibuat oleh ${l.createdByName}`}
        actions={<>
          <StatusTag value={l.displayStatus} labels={LOAN_STATUS_LABEL} />
          {editable && can('loans.create') && <Button asChild variant="secondary"><Link to={`/peminjaman/${l.id}/ubah`}>Ubah</Link></Button>}
          {(editable || l.status === 'APPROVED') && can('loans.create') && <Button variant="secondary" onClick={() => setConfirm('cancel')}>Batalkan</Button>}
          {editable && can('loans.submit') && <Button disabled={act.isPending} onClick={() => act.mutate({ path: `/loans/${l.id}/submit` })}>Ajukan persetujuan</Button>}
          {l.status === 'APPROVED' && can('loans.handover') && <Button onClick={() => setConfirm('handover')}>Serah terima</Button>}
          {running && can('loans.return') && <Button onClick={() => setReturning(true)}>Proses pengembalian</Button>}
        </>}
      />
      {l.displayStatus === 'OVERDUE' && <p role="status" className="mb-4 rounded-control border border-danger/30 bg-danger-wash px-3 py-2 text-sm text-danger-ink">Peminjaman ini melewati rencana pengembalian {formatDate(l.expectedReturnDate)}.</p>}
      <div className="grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <Panel title={`Aset (${l.details.length})`}>
          <div className="-m-4 overflow-x-auto"><table className="w-full min-w-[520px] text-left text-sm">
            <thead><tr className="border-b border-line bg-wash text-muted"><th className="px-4 py-2.5 font-medium">Aset</th><th className="px-4 py-2.5 font-medium">Kondisi pinjam</th><th className="px-4 py-2.5 font-medium">Kembali</th></tr></thead>
            <tbody>{l.details.map((d) => (
              <tr key={d.id} className="border-b border-line last:border-0">
                <td className="px-4 py-3"><Link to={`/aset/${d.asset.id}`} className="hover:underline"><CodeStamp>{d.asset.code}</CodeStamp></Link><span className="mt-1 block">{d.asset.item.name}</span></td>
                <td className="px-4 py-3"><ConditionBadge value={d.conditionBefore} /></td>
                <td className="px-4 py-3">{d.returnedAt ? (<div><ConditionBadge value={d.conditionAfter!} /><span className="mt-1 block text-xs text-muted">{formatDateTime(d.returnedAt)}</span>{d.returnNotes && <span className="block text-xs">{d.returnNotes}</span>}</div>) : <span className="text-muted">Belum kembali</span>}</td>
              </tr>))}</tbody>
          </table></div>
        </Panel>
        <div className="grid grid-cols-[minmax(0,1fr)] content-start gap-4">
          <Panel title="Informasi"><dl>
            <InfoRow label="Peminjam">{l.borrower.name}{l.borrower.position ? ` (${l.borrower.position})` : ''}</InfoRow>
            <InfoRow label="Tanggal pinjam">{formatDate(l.loanDate)}</InfoRow><InfoRow label="Rencana kembali">{formatDate(l.expectedReturnDate)}</InfoRow>
            <InfoRow label="Keperluan">{l.purpose}</InfoRow><InfoRow label="Serah terima">{formatDateTime(l.handedOverAt)}</InfoRow><InfoRow label="Dikembalikan">{formatDateTime(l.returnedAt)}</InfoRow>
          </dl></Panel>
          <Panel title="Persetujuan"><ApprovalTimeline data={l.approval} /></Panel>
        </div>
      </div>
      {returning && <ReturnDialog loan={l} onClose={() => setReturning(false)} />}
      <ConfirmDialog open={!!confirm} onOpenChange={(o) => !o && setConfirm(null)}
        title={confirm === 'cancel' ? 'Batalkan peminjaman?' : 'Catat serah terima?'}
        description={confirm === 'cancel' ? `Peminjaman ${l.number} dibatalkan dan aset kembali dapat dipinjam pihak lain.` : `${l.details.length} aset berstatus dipinjam mulai sekarang.`}
        confirmLabel={confirm === 'cancel' ? 'Batalkan peminjaman' : 'Catat serah terima'} danger={confirm === 'cancel'}
        onConfirm={async () => { await act.mutateAsync({ path: `/loans/${l.id}/${confirm}` }); }} />
    </>
  );
}
