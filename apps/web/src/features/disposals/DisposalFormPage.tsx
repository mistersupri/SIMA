import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useFieldArray, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { DISPOSAL_METHODS, DISPOSAL_METHOD_LABEL, disposalSchema } from '@sima/shared';
import { ApiError, api } from '@/lib/api';
import { todayIso } from '@/lib/format';
import { AssetPicker, type PickedAsset } from '@/components/ui/asset-picker';
import { Button } from '@/components/ui/button';
import { Field, Input, Select, Textarea } from '@/components/ui/form';
import { Card, ErrorState, PageHeader, Spinner } from '@/components/ui/misc';
import { errMsg } from '@/features/docs/common';

export function DisposalFormPage() {
  const { id } = useParams();
  const editing = !!id;
  const navigate = useNavigate();
  const qc = useQueryClient();
  const existing = useQuery({ queryKey: ['disposal', id], enabled: editing, queryFn: async () => (await api.get<any>(`/disposals/${id}`)).data });
  const [picked, setPicked] = useState<Record<string, PickedAsset>>({});
  const { register, control, handleSubmit, reset, setError, formState: { errors, isSubmitting } } = useForm<Record<string, any>>({
    resolver: zodResolver(disposalSchema as never), defaultValues: { date: todayIso(), reason: '', method: 'OTHER', lines: [] },
  });
  const { fields, append, remove } = useFieldArray({ control, name: 'lines' });
  useEffect(() => {
    const d = existing.data;
    if (!d) return;
    setPicked(Object.fromEntries(d.details.map((x: any) => [x.asset.id, { id: x.asset.id, code: x.asset.code, name: x.asset.item.name }])));
    reset({ date: d.date.slice(0, 10), reason: d.reason, method: d.method, lines: d.details.map((x: any) => ({ assetId: x.asset.id, notes: x.notes ?? '' })) });
  }, [existing.data, reset]);
  const top = (k: string) => errors[k]?.message as string | undefined;
  const lineErr = (i: number) => ((errors.lines as any)?.[i]?.assetId?.message as string | undefined);

  const submit = handleSubmit(async (values) => {
    try {
      const res = editing ? await api.patch<any>(`/disposals/${id}`, values) : await api.post<any>('/disposals', values);
      toast.success(res.message);
      await qc.invalidateQueries({ queryKey: ['disposals'] });
      await qc.invalidateQueries({ queryKey: ['disposal', res.data.id] });
      navigate(`/penghapusan/${res.data.id}`);
    } catch (e) {
      if (e instanceof ApiError && e.errors?.length) e.errors.forEach((fe) => setError(fe.field, { message: fe.message }));
      else toast.error(errMsg(e));
    }
  });

  if (editing && existing.isPending) return <div className="py-16 text-center"><Spinner label="Memuat pengajuan…" /></div>;
  if (editing && existing.error) return <ErrorState message={errMsg(existing.error)} onRetry={() => void existing.refetch()} />;
  if (editing && !['DRAFT', 'REJECTED'].includes(existing.data.status)) return <ErrorState message="Pengajuan yang sudah diajukan atau disetujui tidak dapat diedit langsung." />;

  return (
    <>
      <PageHeader title={editing ? `Ubah pengajuan ${existing.data.number}` : 'Buat pengajuan penghapusan'} description="Aset tidak dihapus dari database. Setelah difinalisasi statusnya menjadi dihapuskan dan histori tetap tersimpan." />
      <form onSubmit={submit} noValidate className="grid gap-4">
        <Card className="grid gap-4 p-4 sm:grid-cols-2">
          <Field label="Tanggal pengajuan" error={top('date')} required>{(p) => <Input {...p} type="date" {...register('date')} />}</Field>
          <Field label="Cara penghapusan" error={top('method')} required>{(p) => (<Select {...p} {...register('method')}>{DISPOSAL_METHODS.map((m) => <option key={m} value={m}>{DISPOSAL_METHOD_LABEL[m]}</option>)}</Select>)}</Field>
          <Field label="Alasan penghapusan" error={top('reason')} required className="sm:col-span-2">{(p) => <Textarea {...p} rows={2} {...register('reason')} />}</Field>
        </Card>
        <Card className="p-4">
          <h2 className="mb-3 text-sm font-semibold text-navy">Aset yang diusulkan</h2>
          {top('lines') && <p role="alert" className="mb-2 text-sm text-danger-ink">{top('lines')}</p>}
          <AssetPicker status="AVAILABLE" excludeIds={fields.map((f: any) => f.assetId)} aria-label="Tambah aset" onSelect={(a) => { setPicked((p) => ({ ...p, [a.id]: a })); append({ assetId: a.id, notes: '' }); }} />
          <div className="mt-4 flex flex-col gap-3">
            {fields.length === 0 && <p className="text-sm text-muted">Belum ada aset dipilih.</p>}
            {fields.map((f: any, i) => (
              <div key={f.id} className="grid items-start gap-2 rounded-control border border-line p-3 sm:grid-cols-[1fr_1fr_auto]">
                <div className="text-sm"><span className="code-stamp">{picked[f.assetId]?.code}</span> <span className="ml-1 font-medium">{picked[f.assetId]?.name}</span>{lineErr(i) && <p role="alert" className="mt-1 text-danger-ink">{lineErr(i)}</p>}</div>
                <Field label="Catatan kondisi terakhir">{(p) => <Input {...p} {...register(`lines.${i}.notes`)} />}</Field>
                <Button variant="ghost" size="icon" aria-label={`Hapus ${picked[f.assetId]?.code ?? 'aset'}`} className="sm:mt-7" onClick={() => remove(i)}><Trash2 className="size-4" aria-hidden /></Button>
              </div>
            ))}
          </div>
        </Card>
        <div className="flex gap-2">
          <Button type="submit" disabled={isSubmitting}>{isSubmitting ? 'Menyimpan…' : 'Simpan draft'}</Button>
          <Button asChild variant="ghost"><Link to={editing ? `/penghapusan/${id}` : '/penghapusan'}>Batal</Link></Button>
        </div>
      </form>
    </>
  );
}
