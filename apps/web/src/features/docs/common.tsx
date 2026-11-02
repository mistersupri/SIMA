import { useState, type ReactNode } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Check, CircleDashed, X } from 'lucide-react';
import { ApiError, api } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import { Badge, Card } from '@/components/ui/misc';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field, Textarea } from '@/components/ui/form';

export const errMsg = (e: unknown) => (e instanceof ApiError ? e.message : 'Terjadi kesalahan');

const TONE: Record<string, 'neutral' | 'warning' | 'info' | 'danger' | 'success'> = {
  DRAFT: 'neutral', CANCELLED: 'neutral', PENDING_APPROVAL: 'warning', PARTIALLY_RECEIVED: 'warning', APPROVED: 'info', IN_TRANSFER: 'info', ACTIVE: 'info',
  REJECTED: 'danger', OVERDUE: 'danger', COMPLETED: 'success', RETURNED: 'success', CONFIRMED: 'success',
};

export function StatusTag({ value, labels }: { value: string; labels: Record<string, string> }) {
  return <Badge tone={TONE[value] ?? 'neutral'}>{labels[value] ?? value}</Badge>;
}

export interface Timeline {
  status: string; requestedBy: string; submittedAt: string; completedAt: string | null;
  steps: { order: number; role: string; status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'SKIPPED'; actedBy: string | null; actedAt: string | null; note: string | null }[];
  actions: { action: string; actor: string; note: string | null; createdAt: string }[];
}

const ACTION_LABEL: Record<string, string> = { SUBMIT: 'Diajukan', APPROVE: 'Disetujui', REJECT: 'Ditolak', CANCEL: 'Dibatalkan' };

/** Riwayat persetujuan: siapa, kapan, dan catatannya. */
export function ApprovalTimeline({ data }: { data: Timeline | null }) {
  if (!data) return <p className="text-sm text-muted">Belum diajukan untuk persetujuan.</p>;
  const pending = data.steps.find((s) => s.status === 'PENDING');
  return (
    <ol className="flex flex-col gap-3 text-sm" aria-label="Riwayat persetujuan">
      {data.actions.map((a, i) => (
        <li key={i} className="flex gap-3">
          <span className={`mt-0.5 grid size-5 shrink-0 place-items-center rounded-full text-white ${a.action === 'REJECT' ? 'bg-danger-ink' : a.action === 'APPROVE' ? 'bg-success-ink' : 'bg-muted'}`} aria-hidden>
            {a.action === 'REJECT' ? <X className="size-3" /> : <Check className="size-3" />}
          </span>
          <div>
            <p><span className="font-medium">{ACTION_LABEL[a.action] ?? a.action}</span> oleh {a.actor}</p>
            <p className="text-xs text-muted">{formatDateTime(a.createdAt)}</p>
            {a.note && <p className="mt-1 rounded-control bg-wash px-2 py-1">{a.note}</p>}
          </div>
        </li>
      ))}
      {data.status === 'PENDING' && pending && (
        <li className="flex gap-3 text-muted"><CircleDashed className="mt-0.5 size-5 shrink-0" aria-hidden /><p>Menunggu keputusan {pending.role}</p></li>
      )}
    </ol>
  );
}

export function Panel({ title, children, className }: { title: string; children: ReactNode; className?: string }) {
  return (
    <Card className={className}>
      <h2 className="border-b border-line px-4 py-3 text-sm font-semibold text-navy">{title}</h2>
      <div className="p-4">{children}</div>
    </Card>
  );
}

export function InfoRow({ label, children }: { label: string; children: ReactNode }) {
  return (<div className="grid grid-cols-[8.5rem_1fr] gap-2 border-b border-line py-2 text-sm last:border-0"><dt className="text-muted">{label}</dt><dd className="min-w-0 break-words">{children}</dd></div>);
}

/** Aksi dokumen (ajukan, batalkan, serah terima, dst.) dengan toast dan invalidasi cache. */
export function useDocAction(invalidate: string[][]) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ path, body }: { path: string; body?: unknown }) => api.post(path, body),
    onSuccess: async (res) => {
      toast.success(res.message);
      await Promise.all([...invalidate, ['approvals'], ['notifications']].map((k) => qc.invalidateQueries({ queryKey: k })));
    },
    onError: (e) => toast.error(errMsg(e)),
  });
}

/** Dialog catatan untuk keputusan (setujui: opsional, tolak: wajib). */
export function DecisionDialog({ mode, onClose, onSubmit }: { mode: 'approve' | 'reject' | null; onClose: () => void; onSubmit: (note: string) => Promise<void> }) {
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const reject = mode === 'reject';
  const close = () => { setNote(''); setError(null); onClose(); };
  return (
    <Dialog
      open={!!mode} onOpenChange={(o) => !o && close()} className="max-w-md"
      title={reject ? 'Tolak dokumen' : 'Setujui dokumen'}
      description={reject ? 'Alasan penolakan wajib diisi dan akan dilihat pembuat dokumen.' : 'Keputusan bersifat final dan tercatat atas nama Anda.'}
      footer={<>
        <Button variant="secondary" onClick={close}>Batal</Button>
        <Button variant={reject ? 'danger' : 'primary'} disabled={busy} onClick={async () => {
          if (reject && !note.trim()) { setError('Alasan penolakan wajib diisi'); return; }
          setBusy(true);
          try { await onSubmit(note.trim()); close(); } catch (e) { setError(errMsg(e)); } finally { setBusy(false); }
        }}>{busy ? 'Memproses…' : reject ? 'Tolak' : 'Setujui'}</Button>
      </>}
    >
      <Field label={reject ? 'Alasan penolakan' : 'Catatan (opsional)'} error={error ?? undefined} required={reject}>
        {(p) => <Textarea {...p} rows={3} value={note} onChange={(e) => { setNote(e.target.value); setError(null); }} />}
      </Field>
    </Dialog>
  );
}
