import { useState } from 'react';
import { NavLink, useParams } from 'react-router';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Plus, Search } from 'lucide-react';
import { toast } from 'sonner';
import { ApiError, api, buildQuery } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { cn } from '@/lib/utils';
import { useListState } from '@/hooks/use-list-state';
import { Button } from '@/components/ui/button';
import { Field, Input, Select, Textarea } from '@/components/ui/form';
import { Badge, PageHeader } from '@/components/ui/misc';
import { DataTable, type Column } from '@/components/ui/data-table';
import { Dialog } from '@/components/ui/dialog';
import { ConfirmDialog } from '@/components/ui/confirm';
import { RowMenu } from '@/components/ui/row-menu';
import { MASTER_DEFS, defOf, type FieldDef, type ResourceDef } from './config';

type Row = Record<string, any> & { id: string; isActive: boolean };
const errMsg = (e: unknown) => (e instanceof ApiError ? e.message : 'Terjadi kesalahan');

function SourceSelect({ field, excludeId, ...p }: { field: FieldDef; excludeId?: string } & React.SelectHTMLAttributes<HTMLSelectElement>) {
  const q = useQuery({
    queryKey: ['options', field.source],
    queryFn: async () => (await api.get<Row[]>(`/${field.source}${buildQuery({ limit: 100, isActive: true })}`)).data,
    staleTime: 30_000,
  });
  return (
    <Select {...p}>
      <option value="">Tidak ditentukan</option>
      {q.data?.filter((o) => o.id !== excludeId).map((o) => <option key={o.id} value={o.id}>{o.code ? `${o.code} · ${o.name}` : o.name}</option>)}
    </Select>
  );
}

function FormDialog({ def, row, onClose }: { def: ResourceDef; row: Row | 'new' | null; onClose: () => void }) {
  const qc = useQueryClient();
  const editing = row && row !== 'new' ? row : null;
  const defaults = Object.fromEntries(def.fields.map((f) => [f.name, editing ? (editing[f.name] ?? '') : (f.defaultValue ?? '')]));
  const { register, handleSubmit, setError, formState: { errors, isSubmitting } } = useForm<Record<string, any>>({
    resolver: zodResolver(def.schema as never),
    values: defaults,
  });

  const submit = handleSubmit(async (values) => {
    try {
      if (editing) await api.patch(`/${def.key}/${editing.id}`, values);
      else await api.post(`/${def.key}`, values);
      toast.success(`${def.singular[0]!.toUpperCase()}${def.singular.slice(1)} ${editing ? 'diperbarui' : 'ditambahkan'}`);
      await qc.invalidateQueries({ queryKey: ['master', def.key] });
      await qc.invalidateQueries({ queryKey: ['options', def.key] });
      onClose();
    } catch (e) {
      if (e instanceof ApiError && e.errors?.length) e.errors.forEach((fe) => setError(fe.field, { message: fe.message }));
      else toast.error(errMsg(e));
    }
  });

  return (
    <Dialog
      open={!!row}
      onOpenChange={(o) => !o && onClose()}
      title={`${editing ? 'Ubah' : 'Tambah'} ${def.singular}`}
      footer={<><Button variant="secondary" onClick={onClose}>Batal</Button><Button type="submit" form="master-form" disabled={isSubmitting}>{isSubmitting ? 'Menyimpan…' : 'Simpan'}</Button></>}
    >
      <form id="master-form" onSubmit={submit} noValidate className="flex flex-col gap-4">
        {def.fields.map((f) => {
          const err = errors[f.name]?.message as string | undefined;
          return (
            <Field key={f.name} label={f.label} hint={f.hint} error={err} required={f.required}>
              {(p) =>
                f.kind === 'textarea' ? <Textarea {...p} {...register(f.name)} />
                : f.kind === 'select' && f.source ? <SourceSelect field={f} excludeId={def.selfParent ? editing?.id : undefined} {...p} {...register(f.name)} />
                : f.kind === 'select' ? (
                  <Select {...p} {...register(f.name)}>
                    {!f.noEmpty && <option value="">Tidak ditentukan</option>}
                    {f.options?.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </Select>
                ) : <Input {...p} type={f.kind === 'email' ? 'email' : 'text'} {...register(f.name)} />
              }
            </Field>
          );
        })}
      </form>
    </Dialog>
  );
}

export function MasterPage() {
  const { resource } = useParams();
  const def = defOf(resource ?? '');
  if (!def) {
    return (
      <div role="alert" className="py-20 text-center">
        <h1 className="text-lg font-semibold">Jenis master data tidak dikenal</h1>
      </div>
    );
  }
  return <MasterTable key={def.key} def={def} />;
}

function MasterTable({ def }: { def: ResourceDef }) {
  const { can } = useAuth();
  const qc = useQueryClient();
  const list = useListState({ sortBy: def.defaultSort });
  const [form, setForm] = useState<Row | 'new' | null>(null);
  const [toggle, setToggle] = useState<Row | null>(null);
  const s = list.state;
  const manage = can('master.manage');

  const query = useQuery({
    queryKey: ['master', def.key, s],
    queryFn: ({ signal }) => api.get<Row[]>(`/${def.key}${buildQuery({ page: s.page, limit: s.limit, search: s.search, sortBy: s.sortBy, sortOrder: s.sortOrder, ...s.filters })}`, signal),
    placeholderData: keepPreviousData,
  });

  const columns: Column<Row>[] = [
    ...def.columns.map((c) => ({ key: c.key, header: c.header, sortable: c.sortable, cell: (r: Row) => c.render ? c.render(r) : (['code'].includes(c.key) ? <span className="code-stamp">{r[c.key]}</span> : (r[c.key] ?? <span className="text-muted">-</span>)) })),
    { key: 'isActive', header: 'Status', cell: (r) => <Badge tone={r.isActive ? 'success' : 'neutral'}>{r.isActive ? 'Aktif' : 'Nonaktif'}</Badge> },
    ...(manage ? [{ key: 'actions', header: 'Aksi', className: 'w-16 text-right', cell: (r: Row) => (
      <RowMenu label={`Aksi untuk ${r.name}`} items={[
        { label: 'Ubah', onSelect: () => setForm(r) },
        { label: r.isActive ? 'Nonaktifkan' : 'Aktifkan', danger: r.isActive, onSelect: () => setToggle(r) },
      ]} />
    ) }] : []),
  ];

  return (
    <>
      <PageHeader
        title="Master Data"
        description="Data acuan yang dipakai di seluruh transaksi. Data yang sudah dipakai tidak dihapus, hanya dinonaktifkan."
        actions={manage ? <Button onClick={() => setForm('new')}><Plus className="size-4" aria-hidden /> Tambah {def.singular}</Button> : undefined}
      />
      <nav aria-label="Jenis master data" className="-mx-4 mb-4 overflow-x-auto px-4 lg:mx-0 lg:px-0">
        <ul className="flex min-w-max gap-1 border-b border-line">
          {MASTER_DEFS.map((d) => (
            <li key={d.key}>
              <NavLink to={`/master/${d.key}`} className={({ isActive }) => cn('-mb-px inline-flex min-h-11 items-center border-b-2 px-3 text-sm whitespace-nowrap transition-colors duration-150', isActive ? 'border-brand font-semibold text-navy' : 'border-transparent text-muted hover:text-ink')}>
                {d.label}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>

      <div className="mb-3 flex flex-wrap gap-2">
        <div className="relative min-w-56 flex-1 sm:max-w-xs">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" aria-hidden />
          <Input aria-label={`Cari ${def.singular}`} placeholder={`Cari ${def.singular}`} className="pl-9" value={list.searchInput} onChange={(e) => list.setSearchInput(e.target.value)} />
        </div>
        <Select aria-label="Filter status" className="w-auto" value={s.filters.isActive ?? ''} onChange={(e) => list.setFilter('isActive', e.target.value)}>
          <option value="">Semua status</option><option value="true">Aktif</option><option value="false">Nonaktif</option>
        </Select>
      </div>

      <DataTable
        caption={`Daftar ${def.singular}`}
        columns={columns}
        rows={query.data?.data}
        rowKey={(r) => r.id}
        loading={query.isFetching}
        error={query.error ? errMsg(query.error) : null}
        onRetry={() => void query.refetch()}
        meta={query.data?.meta}
        sortBy={s.sortBy}
        sortOrder={s.sortOrder}
        onSort={list.toggleSort}
        onPage={list.setPage}
        onLimit={list.setLimit}
        empty={{
          title: `Belum ada data ${def.singular}`,
          description: s.search || s.filters.isActive ? 'Tidak ada hasil untuk pencarian ini.' : manage ? `Tambahkan ${def.singular} pertama.` : undefined,
          action: manage && !s.search ? <Button size="sm" onClick={() => setForm('new')}>Tambah {def.singular}</Button> : undefined,
        }}
      />

      <FormDialog def={def} row={form} onClose={() => setForm(null)} />
      <ConfirmDialog
        open={!!toggle}
        onOpenChange={(o) => !o && setToggle(null)}
        title={toggle?.isActive ? `Nonaktifkan ${def.singular}?` : `Aktifkan ${def.singular}?`}
        description={toggle?.isActive ? `"${toggle?.name}" tidak akan muncul sebagai pilihan baru, tetapi histori transaksi tetap utuh.` : `"${toggle?.name}" akan muncul kembali sebagai pilihan.`}
        confirmLabel={toggle?.isActive ? 'Nonaktifkan' : 'Aktifkan'}
        danger={toggle?.isActive}
        onConfirm={async () => {
          try {
            await api.patch(`/${def.key}/${toggle!.id}`, { isActive: !toggle!.isActive });
            toast.success('Status diperbarui');
            await qc.invalidateQueries({ queryKey: ['master', def.key] });
            await qc.invalidateQueries({ queryKey: ['options', def.key] });
          } catch (e) { toast.error(errMsg(e)); throw e; }
        }}
      />
    </>
  );
}
