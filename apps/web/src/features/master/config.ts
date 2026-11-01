import type { ReactNode } from 'react';
import type { ZodType } from 'zod';
import {
  LOCATION_TYPES, LOCATION_TYPE_LABEL, brandSchema, categorySchema, fundingSourceSchema, locationSchema,
  organizationalUnitSchema, personSchema, unitOfMeasureSchema, vendorSchema, warehouseSchema, type MasterResource,
} from '@sima/shared';

export interface FieldDef {
  name: string;
  label: string;
  kind: 'text' | 'textarea' | 'select' | 'email';
  required?: boolean;
  hint?: string;
  /** Opsi dari resource master lain. */
  source?: MasterResource;
  /** Opsi statis [nilai, label]. */
  options?: [string, string][];
  /** Tanpa pilihan kosong. */
  noEmpty?: boolean;
  defaultValue?: string;
}

export interface ColumnDef {
  key: string;
  header: string;
  sortable?: boolean;
  render?: (row: Record<string, any>) => ReactNode;
}

export interface ResourceDef {
  key: MasterResource;
  label: string;
  singular: string;
  schema: ZodType;
  fields: FieldDef[];
  columns: ColumnDef[];
  defaultSort: string;
  /** Resource yang bisa menjadi induk dirinya sendiri (tidak boleh memilih diri sendiri). */
  selfParent?: boolean;
}

const nameOf = (r: Record<string, any> | null | undefined) => r?.name ?? '-';

export const MASTER_DEFS: ResourceDef[] = [
  {
    key: 'organizational-units', label: 'Unit Kerja', singular: 'unit kerja', schema: organizationalUnitSchema, defaultSort: 'code', selfParent: true,
    fields: [
      { name: 'code', label: 'Kode', kind: 'text', required: true },
      { name: 'name', label: 'Nama unit', kind: 'text', required: true },
      { name: 'parentId', label: 'Unit induk', kind: 'select', source: 'organizational-units' },
    ],
    columns: [
      { key: 'code', header: 'Kode', sortable: true }, { key: 'name', header: 'Nama', sortable: true },
      { key: 'parent', header: 'Unit induk', render: (r) => nameOf(r.parent) },
    ],
  },
  {
    key: 'locations', label: 'Lokasi dan Ruangan', singular: 'lokasi', schema: locationSchema, defaultSort: 'code', selfParent: true,
    fields: [
      { name: 'code', label: 'Kode', kind: 'text', required: true },
      { name: 'name', label: 'Nama lokasi', kind: 'text', required: true },
      { name: 'type', label: 'Tipe', kind: 'select', required: true, noEmpty: true, defaultValue: 'ROOM', options: LOCATION_TYPES.map((t) => [t, LOCATION_TYPE_LABEL[t]]) },
      { name: 'parentId', label: 'Lokasi induk', kind: 'select', source: 'locations', hint: 'Contoh: ruangan berinduk lantai, lantai berinduk gedung.' },
      { name: 'unitId', label: 'Unit kerja', kind: 'select', source: 'organizational-units' },
    ],
    columns: [
      { key: 'code', header: 'Kode', sortable: true }, { key: 'name', header: 'Nama', sortable: true },
      { key: 'type', header: 'Tipe', sortable: true, render: (r) => LOCATION_TYPE_LABEL[r.type as keyof typeof LOCATION_TYPE_LABEL] ?? r.type },
      { key: 'parent', header: 'Induk', render: (r) => nameOf(r.parent) }, { key: 'unit', header: 'Unit kerja', render: (r) => nameOf(r.unit) },
    ],
  },
  {
    key: 'categories', label: 'Kategori Barang', singular: 'kategori', schema: categorySchema, defaultSort: 'code', selfParent: true,
    fields: [
      { name: 'code', label: 'Kode', kind: 'text', required: true },
      { name: 'codePrefix', label: 'Awalan kode otomatis', kind: 'text', required: true, hint: '3 huruf, dipakai pada kode barang dan aset (contoh: ELK).' },
      { name: 'name', label: 'Nama kategori', kind: 'text', required: true },
      { name: 'parentId', label: 'Kategori induk', kind: 'select', source: 'categories' },
    ],
    columns: [
      { key: 'code', header: 'Kode', sortable: true }, { key: 'codePrefix', header: 'Awalan' }, { key: 'name', header: 'Nama', sortable: true },
      { key: 'parent', header: 'Induk', render: (r) => nameOf(r.parent) },
    ],
  },
  {
    key: 'units', label: 'Satuan', singular: 'satuan', schema: unitOfMeasureSchema, defaultSort: 'code',
    fields: [{ name: 'code', label: 'Kode', kind: 'text', required: true }, { name: 'name', label: 'Nama satuan', kind: 'text', required: true }],
    columns: [{ key: 'code', header: 'Kode', sortable: true }, { key: 'name', header: 'Nama', sortable: true }],
  },
  {
    key: 'brands', label: 'Merek', singular: 'merek', schema: brandSchema, defaultSort: 'name',
    fields: [{ name: 'name', label: 'Nama merek', kind: 'text', required: true }],
    columns: [{ key: 'name', header: 'Nama', sortable: true }],
  },
  {
    key: 'vendors', label: 'Vendor', singular: 'vendor', schema: vendorSchema, defaultSort: 'code',
    fields: [
      { name: 'code', label: 'Kode', kind: 'text', required: true }, { name: 'name', label: 'Nama vendor', kind: 'text', required: true },
      { name: 'address', label: 'Alamat', kind: 'textarea' }, { name: 'phone', label: 'Telepon', kind: 'text' }, { name: 'email', label: 'Email', kind: 'email' },
    ],
    columns: [{ key: 'code', header: 'Kode', sortable: true }, { key: 'name', header: 'Nama', sortable: true }, { key: 'phone', header: 'Telepon' }, { key: 'email', header: 'Email' }],
  },
  {
    key: 'funding-sources', label: 'Sumber Perolehan', singular: 'sumber perolehan', schema: fundingSourceSchema, defaultSort: 'code',
    fields: [{ name: 'code', label: 'Kode', kind: 'text', required: true }, { name: 'name', label: 'Nama sumber', kind: 'text', required: true }],
    columns: [{ key: 'code', header: 'Kode', sortable: true }, { key: 'name', header: 'Nama', sortable: true }],
  },
  {
    key: 'persons', label: 'Penanggung Jawab', singular: 'penanggung jawab', schema: personSchema, defaultSort: 'name',
    fields: [
      { name: 'name', label: 'Nama', kind: 'text', required: true }, { name: 'nip', label: 'NIP', kind: 'text' },
      { name: 'position', label: 'Jabatan', kind: 'text' }, { name: 'unitId', label: 'Unit kerja', kind: 'select', source: 'organizational-units' },
      { name: 'phone', label: 'Telepon', kind: 'text' }, { name: 'email', label: 'Email', kind: 'email' },
    ],
    columns: [
      { key: 'name', header: 'Nama', sortable: true }, { key: 'nip', header: 'NIP', sortable: true }, { key: 'position', header: 'Jabatan' },
      { key: 'unit', header: 'Unit kerja', render: (r) => nameOf(r.unit) },
    ],
  },
  {
    key: 'warehouses', label: 'Gudang', singular: 'gudang', schema: warehouseSchema, defaultSort: 'code',
    fields: [
      { name: 'code', label: 'Kode', kind: 'text', required: true }, { name: 'name', label: 'Nama gudang', kind: 'text', required: true },
      { name: 'locationId', label: 'Lokasi fisik', kind: 'select', source: 'locations' },
    ],
    columns: [{ key: 'code', header: 'Kode', sortable: true }, { key: 'name', header: 'Nama', sortable: true }, { key: 'location', header: 'Lokasi', render: (r) => nameOf(r.location) }],
  },
];

export const defOf = (key: string) => MASTER_DEFS.find((d) => d.key === key);
