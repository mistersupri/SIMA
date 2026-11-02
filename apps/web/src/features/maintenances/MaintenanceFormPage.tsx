import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import { MAINTENANCE_TYPES, MAINTENANCE_TYPE_LABEL, maintenanceSchema } from '@sima/shared';
import { ApiError, api } from '@/lib/api';
import { todayIso } from '@/lib/format';
import { useOptions } from '@/hooks/use-options';
import { AssetPicker, type PickedAsset } from '@/components/ui/asset-picker';
import { Button } from '@/components/ui/button';
import { Field, Input, Select, Textarea } from '@/components/ui/form';
import { Card, ErrorState, PageHeader, Spinner } from '@/components/ui/misc';
import { errMsg } from '@/features/docs/common';

export function MaintenanceFormPage() {
  const { id } = useParams();
  const editing = !!id;
  const navigate = useNavigate();
  const qc = useQueryClient();
  const vendors = useOptions('/vendors');
  const existing = useQuery({ queryKey: ['maintenance', id], enabled: editing, queryFn: async () => (await api.get<any>(`/maintenances/${id}`)).data });
  const [asset, setAsset] = useState<PickedAsset | null>(null);
  const { register, handleSubmit, reset, setError, setValue, formState: { errors, isSubmitting } } = useForm<Record<string, any>>({
    resolver: zodResolver(maintenanceSchema as never),
    defaultValues: { assetId: '', date: todayIso(), type: 'CORRECTIVE', damageDescription: '', vendorId: '', performerName: '' },
  });
  useEffect(() => {
    const m = existing.data;
    if (!m) return;
    setAsset({ id: m.asset.id, code: m.asset.code, name: m.asset.item.name });
    reset({ assetId: m.assetId, date: m.date.slice(0, 10), type: m.type, damageDescription: m.damageDescription, vendorId: m.vendorId ?? '', performerName: m.performerName ?? '' });
  }, [existing.data, reset]);
  const err = (k: string) => errors[k]?.message as string | undefined;

  const submit = handleSubmit(async (values) => {
    try {
      const res = editing ? await api.patch<any>(`/maintenances/${id}`, values) : await api.post<any>('/maintenances', values);
      toast.success(res.message);
      await qc.invalidateQueries({ queryKey: ['maintenances'] });
      await qc.invalidateQueries({ queryKey: ['maintenance', res.data.id] });
      navigate(`/pemeliharaan/${res.data.id}`);
    } catch (e) {
      if (e instanceof ApiError && e.errors?.length) e.errors.forEach((fe) => setError(fe.field, { message: fe.message }));
      else toast.error(errMsg(e));
    }
  });

  if (editing && existing.isPending) return <div className="py-16 text-center"><Spinner label="Memuat pemeliharaan…" /></div>;
  if (editing && existing.error) return <ErrorState message={errMsg(existing.error)} onRetry={() => void existing.refetch()} />;
  if (editing && !['REPORTED', 'REJECTED'].includes(existing.data.status)) return <ErrorState message="Pemeliharaan yang sudah diajukan atau disetujui tidak dapat diedit langsung." />;

  return (
    <>
      <PageHeader title={editing ? `Ubah pemeliharaan ${existing.data.number}` : 'Laporkan pemeliharaan'} description="Aset baru berstatus dalam perbaikan setelah disetujui dan perbaikan dimulai." />
      <form onSubmit={submit} noValidate className="grid max-w-3xl gap-4">
        <Card className="grid gap-4 p-4 sm:grid-cols-2">
          <Field label="Aset" error={err('assetId')} required className="sm:col-span-2">
            {(p) => (
              <div className="grid gap-2">
                <AssetPicker id={p.id} invalid={p['aria-invalid']} onSelect={(a) => { setAsset(a); setValue('assetId', a.id, { shouldValidate: true }); }} placeholder={asset ? 'Ganti aset: cari kode atau nama' : 'Cari kode, nomor seri, atau nama aset'} />
                {asset && <p className="text-sm"><span className="code-stamp">{asset.code}</span> <span className="ml-1 font-medium">{asset.name}</span></p>}
              </div>
            )}
          </Field>
          <Field label="Tanggal" error={err('date')} required>{(p) => <Input {...p} type="date" {...register('date')} />}</Field>
          <Field label="Jenis" error={err('type')} required>{(p) => (<Select {...p} {...register('type')}>{MAINTENANCE_TYPES.map((t) => <option key={t} value={t}>{MAINTENANCE_TYPE_LABEL[t]}</option>)}</Select>)}</Field>
          <Field label="Deskripsi kerusakan / keperluan" error={err('damageDescription')} required className="sm:col-span-2">{(p) => <Textarea {...p} rows={3} {...register('damageDescription')} />}</Field>
          <Field label="Vendor pelaksana" error={err('vendorId')}>{(p) => (<Select {...p} {...register('vendorId')}><option value="">Tidak ditentukan</option>{vendors.data?.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}</Select>)}</Field>
          <Field label="Nama pelaksana / teknisi" error={err('performerName')}>{(p) => <Input {...p} {...register('performerName')} />}</Field>
        </Card>
        <div className="flex gap-2">
          <Button type="submit" disabled={isSubmitting}>{isSubmitting ? 'Menyimpan…' : 'Simpan laporan'}</Button>
          <Button asChild variant="ghost"><Link to={editing ? `/pemeliharaan/${id}` : '/pemeliharaan'}>Batal</Link></Button>
        </div>
      </form>
    </>
  );
}
