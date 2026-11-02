import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { loanSchema } from '@sima/shared';
import { ApiError, api } from '@/lib/api';
import { todayIso } from '@/lib/format';
import { useOptions } from '@/hooks/use-options';
import { AssetPicker, type PickedAsset } from '@/components/ui/asset-picker';
import { Button } from '@/components/ui/button';
import { Field, Input, Select, Textarea } from '@/components/ui/form';
import { Card, ErrorState, PageHeader, Spinner } from '@/components/ui/misc';
import { errMsg } from '@/features/docs/common';

export function LoanFormPage() {
  const { id } = useParams();
  const editing = !!id;
  const navigate = useNavigate();
  const qc = useQueryClient();
  const persons = useOptions('/persons');
  const units = useOptions('/organizational-units');
  const existing = useQuery({ queryKey: ['loan', id], enabled: editing, queryFn: async () => (await api.get<any>(`/loans/${id}`)).data });
  const [assets, setAssets] = useState<PickedAsset[]>([]);
  const { register, handleSubmit, reset, setError, setValue, formState: { errors, isSubmitting } } = useForm<Record<string, any>>({
    resolver: zodResolver(loanSchema as never),
    defaultValues: { borrowerPersonId: '', unitId: '', loanDate: todayIso(), expectedReturnDate: '', purpose: '', assetIds: [] },
  });
  useEffect(() => {
    const l = existing.data;
    if (!l) return;
    setAssets(l.details.map((d: any) => ({ id: d.asset.id, code: d.asset.code, name: d.asset.item.name, location: d.asset.location.name })));
    reset({ borrowerPersonId: l.borrowerPersonId, unitId: l.unitId ?? '', loanDate: l.loanDate.slice(0, 10), expectedReturnDate: l.expectedReturnDate.slice(0, 10), purpose: l.purpose, assetIds: l.details.map((d: any) => d.asset.id) });
  }, [existing.data, reset]);
  const sync = (next: PickedAsset[]) => { setAssets(next); setValue('assetIds', next.map((a) => a.id), { shouldValidate: true }); };
  const err = (k: string) => errors[k]?.message as string | undefined;

  const submit = handleSubmit(async (values) => {
    try {
      const res = editing ? await api.patch<any>(`/loans/${id}`, values) : await api.post<any>('/loans', values);
      toast.success(res.message);
      await qc.invalidateQueries({ queryKey: ['loans'] });
      await qc.invalidateQueries({ queryKey: ['loan', res.data.id] });
      navigate(`/peminjaman/${res.data.id}`);
    } catch (e) {
      if (e instanceof ApiError && e.errors?.length) e.errors.forEach((fe) => setError(fe.field.startsWith('assetIds') ? 'assetIds' : fe.field, { message: fe.message }));
      else toast.error(errMsg(e));
    }
  });

  if (editing && existing.isPending) return <div className="py-16 text-center"><Spinner label="Memuat peminjaman…" /></div>;
  if (editing && existing.error) return <ErrorState message={errMsg(existing.error)} onRetry={() => void existing.refetch()} />;
  if (editing && !['DRAFT', 'REJECTED'].includes(existing.data.status)) return <ErrorState message="Peminjaman yang sudah diajukan atau disetujui tidak dapat diedit langsung." />;

  return (
    <>
      <PageHeader title={editing ? `Ubah peminjaman ${existing.data.number}` : 'Buat peminjaman'} description="Hanya aset berstatus tersedia yang dapat dipilih. Aset terkunci untuk peminjam lain saat diajukan." />
      <form onSubmit={submit} noValidate className="grid gap-4">
        <Card className="grid gap-4 p-4 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Peminjam" error={err('borrowerPersonId')} required className="sm:col-span-2">{(p) => (<Select {...p} {...register('borrowerPersonId')}><option value="">Pilih peminjam</option>{persons.data?.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</Select>)}</Field>
          <Field label="Unit kerja" error={err('unitId')} className="sm:col-span-2">{(p) => (<Select {...p} {...register('unitId')}><option value="">Tidak ditentukan</option>{units.data?.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</Select>)}</Field>
          <Field label="Tanggal pinjam" error={err('loanDate')} required>{(p) => <Input {...p} type="date" {...register('loanDate')} />}</Field>
          <Field label="Rencana pengembalian" error={err('expectedReturnDate')} required>{(p) => <Input {...p} type="date" {...register('expectedReturnDate')} />}</Field>
          <Field label="Keperluan" error={err('purpose')} required className="sm:col-span-2">{(p) => <Textarea {...p} rows={2} {...register('purpose')} />}</Field>
        </Card>
        <Card className="p-4">
          <h2 className="mb-3 text-sm font-semibold text-navy">Aset yang dipinjam</h2>
          <AssetPicker status="AVAILABLE" excludeIds={assets.map((a) => a.id)} aria-label="Tambah aset" invalid={!!err('assetIds')} onSelect={(a) => sync([...assets, a])} />
          {err('assetIds') && <p role="alert" className="mt-2 text-sm text-danger-ink">{err('assetIds')}</p>}
          {assets.length === 0 ? <p className="mt-3 text-sm text-muted">Belum ada aset dipilih.</p> : (
            <ul className="mt-3 divide-y divide-line rounded-control border border-line">
              {assets.map((a) => (
                <li key={a.id} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
                  <span><span className="code-stamp">{a.code}</span> <span className="ml-1 font-medium">{a.name}</span>{a.location && <span className="ml-2 text-muted">{a.location}</span>}</span>
                  <Button variant="ghost" size="icon" aria-label={`Hapus ${a.code}`} onClick={() => sync(assets.filter((x) => x.id !== a.id))}><Trash2 className="size-4" aria-hidden /></Button>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <div className="flex gap-2">
          <Button type="submit" disabled={isSubmitting}>{isSubmitting ? 'Menyimpan…' : 'Simpan draft'}</Button>
          <Button asChild variant="ghost"><Link to={editing ? `/peminjaman/${id}` : '/peminjaman'}>Batal</Link></Button>
        </div>
      </form>
    </>
  );
}
