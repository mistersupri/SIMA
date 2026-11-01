import type { ZodType } from 'zod';
import {
  brandSchema, categorySchema, fundingSourceSchema, locationSchema, organizationalUnitSchema, personSchema,
  unitOfMeasureSchema, vendorSchema, warehouseSchema, type MasterResource,
} from '@sima/shared';

export interface MasterConfig {
  path: MasterResource;
  /** Nama delegate Prisma. */
  model: string;
  entity: string;
  label: string;
  schema: ZodType;
  searchFields: string[];
  sortable: string[];
  defaultSort: string;
  include?: Record<string, unknown>;
  /** Kolom induk bila resource berbentuk pohon (untuk cegah siklus). */
  parentKey?: 'parentId';
}

export const MASTER_REGISTRY: MasterConfig[] = [
  { path: 'organizational-units', model: 'organizationalUnit', entity: 'OrganizationalUnit', label: 'Unit kerja', schema: organizationalUnitSchema, searchFields: ['code', 'name'], sortable: ['code', 'name', 'createdAt'], defaultSort: 'code', include: { parent: { select: { id: true, name: true } } }, parentKey: 'parentId' },
  { path: 'locations', model: 'location', entity: 'Location', label: 'Lokasi', schema: locationSchema, searchFields: ['code', 'name'], sortable: ['code', 'name', 'type', 'createdAt'], defaultSort: 'code', include: { parent: { select: { id: true, name: true } }, unit: { select: { id: true, name: true } } }, parentKey: 'parentId' },
  { path: 'categories', model: 'category', entity: 'Category', label: 'Kategori', schema: categorySchema, searchFields: ['code', 'name', 'codePrefix'], sortable: ['code', 'name', 'createdAt'], defaultSort: 'code', include: { parent: { select: { id: true, name: true } } }, parentKey: 'parentId' },
  { path: 'units', model: 'unitOfMeasure', entity: 'UnitOfMeasure', label: 'Satuan', schema: unitOfMeasureSchema, searchFields: ['code', 'name'], sortable: ['code', 'name', 'createdAt'], defaultSort: 'code' },
  { path: 'brands', model: 'brand', entity: 'Brand', label: 'Merek', schema: brandSchema, searchFields: ['name'], sortable: ['name', 'createdAt'], defaultSort: 'name' },
  { path: 'vendors', model: 'vendor', entity: 'Vendor', label: 'Vendor', schema: vendorSchema, searchFields: ['code', 'name', 'email'], sortable: ['code', 'name', 'createdAt'], defaultSort: 'code' },
  { path: 'funding-sources', model: 'fundingSource', entity: 'FundingSource', label: 'Sumber perolehan', schema: fundingSourceSchema, searchFields: ['code', 'name'], sortable: ['code', 'name', 'createdAt'], defaultSort: 'code' },
  { path: 'persons', model: 'person', entity: 'Person', label: 'Penanggung jawab', schema: personSchema, searchFields: ['name', 'nip', 'position'], sortable: ['name', 'nip', 'createdAt'], defaultSort: 'name', include: { unit: { select: { id: true, name: true } } } },
  { path: 'warehouses', model: 'warehouse', entity: 'Warehouse', label: 'Gudang', schema: warehouseSchema, searchFields: ['code', 'name'], sortable: ['code', 'name', 'createdAt'], defaultSort: 'code', include: { location: { select: { id: true, name: true } } } },
];
