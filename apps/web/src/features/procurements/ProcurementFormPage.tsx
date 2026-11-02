import { useEffect } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useFieldArray, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { procurementSchema } from '@sima/shared';
import { ApiError, api } from '@/lib/api';
import { formatRupiah, todayIso } from '@/lib/format';
import { optionLabel, useOptions } from '@/hooks/use-options';
import { Button } from '@/components/ui/button';
import { Field, Input, Select, Textarea } from '@/components/ui/form';
import { Card, ErrorState, PageHeader, Spinner } from '@/components/ui/misc';
import { errMsg } from '@/features/docs/common';

export function ProcurementFormPage() {
  const { id } = useParams();
  const editing = !!id;
  const navigate = useNavigate();
  const qc = useQueryClient();
  const vendors = useOptions('/vendors');
  const funding = useOptions('/funding-sources');
  const items = useOptions('/items');
  const existing = useQuery({ queryKey: ['procurement', id], enabled: editing, queryFn: async () => (await api.get<any>(`/procurements/${id}`)).data });

  const { register, control, handleSubmit, reset, setError, watch, formState: { errors, isSubmitting } } = useForm<Record<string, any>>({
    resolver: zodResolver(procurementSchema as never),
    defaultValues: { date: todayIso(), fiscalYear: new Date().getFullYear(), vendorId: '', fundingSourceId: '', notes: '', lines: [{ itemId: '', quantity: '', unitPrice: '' }] },
  });
  const { fields, append, remove } = useFieldArray({ control, name: 'lines' });
  useEffect(() => {
    const p = existing.data;
    if (p) reset({ date: p.date.slice(0, 10), fiscalYear: p.fiscalYear, vendorId: p.vendorId, fundingSourceId: p.fundingSourceId ?? '', notes: p.notes ?? '', lines: p.details.map((d: any) => ({ itemId: d.itemId, quantity: d.quantity, unitPrice: d.unitPrice })) });
  }, [existing.data, reset]);

  const lines = watch('lines') as { quantity: string; unitPrice: string }[];
  const total = lines.reduce((s, l) => s + (Number(l.quantity) || 0) * (Number(l.unitPrice) || 0), 0);
  const top = (k: string) => errors[k]?.message as string | undefined;
  const lineErr = (i: number, k: string) => ((errors.lines as any)?.[i]?.[k]?.message as string | undefined);

  const submit = handleSubmit(async (values) => {
    try {
      const res = editing ? await api.patch<any>(`/procurements/${id}`, values) : await api.post<any>('/procurements', values);
      toast.success(res.message);
      await qc.invalidateQueries({ queryKey: ['procurements'] });
      await qc.invalidateQueries({ queryKey: ['procurement', res.data.id] });
      navigate(`/pengadaan/${res.data.id}`);
    } catch (e) {
      if (e instanceof ApiError && e.errors?.length) e.errors.forEach((fe) => setError(fe.field, { message: fe.message }));
      else toast.error(errMsg(e));
    }
  });

  if (editing && existing.isPending) return <div className="py-16 text-center"><Spinner label="Memuat pengadaan…" /></div>;
  if (editing && existing.error) return <ErrorState message={errMsg(existing.error)} onRetry={() => void existing.refetch()} />;
  if (editing && !['DRAFT', 'REJECTED'].includes(existing.data.status)) return <ErrorState message="Pengadaan yang sudah diajukan atau disetujui tidak dapat diedit langsung." />;

  return (
    <>
      <PageHeader title={editing ? `Ubah pengadaan ${existing.data.number}` : 'Buat pengadaan'} description="Disimpan sebagai draft. Ajukan untuk persetujuan dari halaman detail." />
      <form onSubmit={submit} noValidate className="grid gap-4">
        <Card className="grid gap-4 p-4 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Tanggal" error={top('date')} required>{(p) => <Input {...p} type="date" {...register('date')} />}</Field>
          <Field label="Tahun anggaran" error={top('fiscalYear')} required>{(p) => <Input {...p} type="number" {...register('fiscalYear')} />}</Field>
          <Field label="Vendor" error={top('vendorId')} required>{(p) => (<Select {...p} {...register('vendorId')}><option value="">Pilih vendor</option>{vendors.data?.map((v) => <option key={v.id} value={v.id}>{optionLabel(v)}</option>)}</Select>)}</Field>
          <Field label="Sumber dana" error={top('fundingSourceId')}>{(p) => (<Select {...p} {...register('fundingSourceId')}><option value="">Tidak ditentukan</option>{funding.data?.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}</Select>)}</Field>
          <Field label="Catatan" error={top('notes')} className="sm:col-span-2 lg:col-span-4">{(p) => <Textarea {...p} rows={2} {...register('notes')} />}</Field>
        </Card>

        <Card className="p-4">
          <fieldset className="flex flex-col gap-3">
            <legend className="mb-2 text-sm font-semibold text-navy">Barang yang dipesan</legend>
            {top('lines') && <p role="alert" className="text-sm text-danger-ink">{top('lines')}</p>}
            {fields.map((f, i) => (
              <div key={f.id} className="grid grid-cols-2 items-start gap-2 border-b border-line pb-3 last:border-0 sm:grid-cols-[1fr_7rem_10rem_auto]">
                <Field label={`Barang ${i + 1}`} error={lineErr(i, 'itemId')} className="col-span-2 sm:col-span-1">
                  {(p) => (<Select {...p} {...register(`lines.${i}.itemId`)}><option value="">Pilih barang</option>{items.data?.map((o) => <option key={o.id} value={o.id}>{optionLabel(o)} ({(o as any).type === 'ASSET' ? 'inventaris' : 'persediaan'})</option>)}</Select>)}
                </Field>
                <Field label="Jumlah" error={lineErr(i, 'quantity')}>{(p) => <Input {...p} type="number" min="0" step="any" inputMode="decimal" {...register(`lines.${i}.quantity`)} />}</Field>
                <Field label="Harga satuan (Rp)" error={lineErr(i, 'unitPrice')}>{(p) => <Input {...p} type="number" min="0" inputMode="numeric" {...register(`lines.${i}.unitPrice`)} />}</Field>
                <Button variant="ghost" size="icon" aria-label={`Hapus baris ${i + 1}`} className="col-span-2 justify-self-end sm:col-span-1 sm:mt-7" disabled={fields.length === 1} onClick={() => remove(i)}><Trash2 className="size-4" aria-hidden /></Button>
              </div>
            ))}
            <div className="flex flex-wrap items-center justify-between gap-3">
              <Button variant="secondary" size="sm" onClick={() => append({ itemId: '', quantity: '', unitPrice: '' })}><Plus className="size-4" aria-hidden /> Tambah baris</Button>
              <p className="text-sm">Total: <span className="text-base font-semibold">{formatRupiah(total)}</span></p>
            </div>
          </fieldset>
        </Card>
        <div className="flex gap-2">
          <Button type="submit" disabled={isSubmitting}>{isSubmitting ? 'Menyimpan…' : 'Simpan draft'}</Button>
          <Button asChild variant="ghost"><Link to={editing ? `/pengadaan/${id}` : '/pengadaan'}>Batal</Link></Button>
        </div>
      </form>
    </>
  );
}
