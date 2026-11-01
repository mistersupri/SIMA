import { z } from 'zod';
import { codeField, optionalEmail, optionalText, optionalUuid, requiredText } from './common';

const isActive = z.boolean().optional();

export const organizationalUnitSchema = z.object({
  code: codeField('Kode unit'),
  name: requiredText('Nama unit', 150),
  parentId: optionalUuid('Unit induk'),
  isActive,
});

export const LOCATION_TYPES = ['BUILDING', 'FLOOR', 'ROOM', 'WAREHOUSE_AREA', 'OTHER'] as const;
export const LOCATION_TYPE_LABEL: Record<(typeof LOCATION_TYPES)[number], string> = {
  BUILDING: 'Gedung',
  FLOOR: 'Lantai',
  ROOM: 'Ruangan',
  WAREHOUSE_AREA: 'Area gudang',
  OTHER: 'Lainnya',
};

export const locationSchema = z.object({
  code: codeField('Kode lokasi'),
  name: requiredText('Nama lokasi', 150),
  type: z.enum(LOCATION_TYPES, { error: 'Tipe lokasi tidak valid' }),
  parentId: optionalUuid('Lokasi induk'),
  unitId: optionalUuid('Unit kerja'),
  isActive,
});

export const categorySchema = z.object({
  code: codeField('Kode kategori'),
  codePrefix: z
    .string({ error: 'Awalan kode wajib diisi' })
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{3}$/, 'Awalan kode harus 3 huruf (contoh: ELK)'),
  name: requiredText('Nama kategori', 150),
  parentId: optionalUuid('Kategori induk'),
  isActive,
});

export const unitOfMeasureSchema = z.object({
  code: codeField('Kode satuan'),
  name: requiredText('Nama satuan', 60),
  isActive,
});

export const brandSchema = z.object({ name: requiredText('Nama merek', 100), isActive });

export const vendorSchema = z.object({
  code: codeField('Kode vendor'),
  name: requiredText('Nama vendor', 150),
  address: optionalText('Alamat', 300),
  phone: optionalText('Telepon', 40),
  email: optionalEmail,
  isActive,
});

export const fundingSourceSchema = z.object({
  code: codeField('Kode sumber'),
  name: requiredText('Nama sumber perolehan', 120),
  isActive,
});

export const personSchema = z.object({
  nip: optionalText('NIP', 30),
  name: requiredText('Nama', 120),
  position: optionalText('Jabatan', 120),
  unitId: optionalUuid('Unit kerja'),
  phone: optionalText('Telepon', 40),
  email: optionalEmail,
  isActive,
});

export const warehouseSchema = z.object({
  code: codeField('Kode gudang'),
  name: requiredText('Nama gudang', 120),
  locationId: optionalUuid('Lokasi'),
  isActive,
});

/** Kunci resource master data => path REST /api/v1/<path>. */
export const MASTER_RESOURCES = [
  'organizational-units',
  'locations',
  'categories',
  'units',
  'brands',
  'vendors',
  'funding-sources',
  'persons',
  'warehouses',
] as const;
export type MasterResource = (typeof MASTER_RESOURCES)[number];
