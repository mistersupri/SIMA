import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useFieldArray, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { mutationSchema } from '@sima/shared';
import { ApiError, api } from '@/lib/api';
import { todayIso } from '@/lib/format';
import { optionLabel, useOptions } from '@/hooks/use-options';
import { AssetPicker, type PickedAsset } from '@/components/ui/asset-picker';
import { Button } from '@/components/ui/button';
import { Field, Input, Select, Textarea } from '@/components/ui/form';
import { Card, ErrorState, PageHeader, Spinner } from '@/components/ui/misc';
import { errMsg } from '@/features/docs/common';

export function MutationFormPage() {
  const { id } = useParams();
  const editing = !!id;
  const navigate = useNavigate();
  const qc = useQueryClient();
  const units = useOptions('/organizational-units');
  const locations = useOptions('/locations');
  const persons = useOptions('/persons');
  const existing = useQuery({ queryKey: ['mutation', id], enabled: editing, queryFn: async () => (await api.get<any>(`/mutations/${id}`)).data });
  const [picked, setPicked] = useState<Record<string, PickedAsset>>({});

  const { register, control, handleSubmit, reset, setError, formState: { errors, isSubmitting } } = useForm<Record<string, any>>({
    resolver: zodResolver(mutationSchema as never),
    defaultValues: { date: todayIso(), reason: '', lines: [] },
  });
  const { fields, append, remove } = useFieldArray({ control, name: 'lines' });

  useEffect(() => {
    const m = existing.data;
    if (!m) return;
    setPicked(Object.fromEntries(m.details.map((d: any) => [d.asset.id, { id: d.asset.id, code: d.asset.code, name: d.asset.item.name }])));
    reset({ date: m.date.slice(0, 10), reason: m.reason, lines: m.details.map((d: any) => ({ assetId: d.asset.id, toUnitId: d.toUnitId ?? '', toLocationId: d.toLocationId ?? '', toPersonId: d.toPersonId ?? '' })) });
  }, [existing.data, reset]);

  const top = (k: string) => errors[k]?.message as string | undefined;
  const lineErr = (i: number, k: string) => ((errors.lines as any)?.[i]?.[k]?.message as string | undefined);
  const chosen = fields.map((f: any) => f.assetId as string);

  const submit = handleSubmit(async (values) => {
    try {
      const res = editing ? await api.patch<any>(`/mutations/${id}`, values) : await api.post<any>('/mutations', values);
      toast.success(res.message);
      await qc.invalidateQueries({ queryKey: ['mutations'] });
      await qc.invalidateQueries({ queryKey: ['mutation', res.data.id] });
      navigate(`/mutasi/${res.data.id}`);
    } catch (e) {
      if (e instanceof ApiError && e.errors?.length) e.errors.forEach((fe) => setError(fe.field, { message: fe.message }));
      else toast.error(errMsg(e));
    }
  });

  if (editing && existing.isPending) return <div className="py-16 text-center"><Spinner label="Memuat mutasi…" /></div>;
  if (editing && existing.error) return <ErrorState message={errMsg(existing.error)} onRetry={() => void existing.refetch()} />;
  if (editing && !['DRAFT', 'REJECTED'].includes(existing.data.status)) return <ErrorState message="Mutasi yang sudah diajukan atau disetujui tidak dapat diedit langsung." />;

  return (
    <>
      <PageHeader title={editing ? `Ubah mutasi ${existing.data.number}` : 'Buat mutasi'} description="Pilih aset yang tersedia lalu tentukan tujuannya. Posisi asal dicatat otomatis dari data saat ini." />
      <form onSubmit={submit} noValidate className="grid gap-4">
        <Card className="grid gap-4 p-4 sm:grid-cols-[12rem_1fr]">
          <Field label="Tanggal" error={top('date')} required>{(p) => <Input {...p} type="date" {...register('date')} />}</Field>
          <Field label="Alasan mutasi" error={top('reason')} required>{(p) => <Textarea {...p} rows={2} {...register('reason')} />}</Field>
        </Card>
        <Card className="p-4">
          <h2 className="mb-3 text-sm font-semibold text-navy">Aset yang dimutasi</h2>
          {top('lines') && <p role="alert" className="mb-2 text-sm text-danger-ink">{top('lines')}</p>}
          <AssetPicker status="AVAILABLE" excludeIds={chosen} aria-label="Tambah aset" onSelect={(a) => { setPicked((p) => ({ ...p, [a.id]: a })); append({ assetId: a.id, toUnitId: '', toLocationId: '', toPersonId: '' }); }} />
          <div className="mt-4 flex flex-col gap-4">
            {fields.length === 0 && <p className="text-sm text-muted">Belum ada aset dipilih. Cari dan pilih aset di atas.</p>}
            {fields.map((f: any, i) => (
              <div key={f.id} className="rounded-control border border-line p-3">
                <div className="mb-2 flex items-start justify-between gap-2">
                  <div className="text-sm"><span className="code-stamp">{picked[f.assetId]?.code}</span> <span className="ml-1 font-medium">{picked[f.assetId]?.name}</span>{lineErr(i, 'assetId') && <p role="alert" className="mt-1 text-danger-ink">{lineErr(i, 'assetId')}</p>}</div>
                  <Button variant="ghost" size="icon" aria-label={`Hapus ${picked[f.assetId]?.code ?? 'aset'}`} onClick={() => remove(i)}><Trash2 className="size-4" aria-hidden /></Button>
                </div>
                <div className="grid gap-3 sm:grid-cols-3">
                  <Field label="Unit tujuan" error={lineErr(i, 'toUnitId')} required>{(p) => (<Select {...p} {...register(`lines.${i}.toUnitId`)}><option value="">Pilih unit</option>{units.data?.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</Select>)}</Field>
                  <Field label="Lokasi tujuan" error={lineErr(i, 'toLocationId')} required>{(p) => (<Select {...p} {...register(`lines.${i}.toLocationId`)}><option value="">Pilih lokasi</option>{locations.data?.map((o) => <option key={o.id} value={o.id}>{optionLabel(o)}</option>)}</Select>)}</Field>
                  <Field label="Penanggung jawab baru" error={lineErr(i, 'toPersonId')}>{(p) => (<Select {...p} {...register(`lines.${i}.toPersonId`)}><option value="">Tanpa penanggung jawab</option>{persons.data?.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</Select>)}</Field>
                </div>
              </div>
            ))}
          </div>
        </Card>
        <div className="flex gap-2">
          <Button type="submit" disabled={isSubmitting}>{isSubmitting ? 'Menyimpan…' : 'Simpan draft'}</Button>
          <Button asChild variant="ghost"><Link to={editing ? `/mutasi/${id}` : '/mutasi'}>Batal</Link></Button>
        </div>
      </form>
    </>
  );
}
