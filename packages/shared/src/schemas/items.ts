import { z } from 'zod';
import { optionalText, optionalUuid, requiredText, uuid } from './common';

export const ITEM_TYPES = ['ASSET', 'SUPPLY'] as const;
export const ITEM_TYPE_LABEL = { ASSET: 'Inventaris', SUPPLY: 'Persediaan' } as const;

const quantity = (label: string) =>
  z.coerce.number({ error: `${label} harus berupa angka` }).finite().min(0, `${label} tidak boleh negatif`).max(999_999_999, `${label} terlalu besar`);

export const createItemSchema = z.object({
  name: requiredText('Nama barang', 200),
  type: z.enum(ITEM_TYPES, { error: 'Jenis barang wajib dipilih' }),
  categoryId: uuid('Kategori'),
  brandId: optionalUuid('Merek'),
  model: optionalText('Tipe/model', 150),
  specification: optionalText('Spesifikasi', 1000),
  description: optionalText('Deskripsi', 1000),
  unitOfMeasureId: uuid('Satuan'),
  minStock: quantity('Stok minimum').default(0),
});
export type CreateItemInput = z.infer<typeof createItemSchema>;

/** Jenis barang tidak dapat diubah setelah dibuat. */
export const updateItemSchema = createItemSchema.omit({ type: true });
export type UpdateItemInput = z.infer<typeof updateItemSchema>;

export const ASSET_CONDITIONS = ['GOOD', 'MINOR_DAMAGE', 'MAJOR_DAMAGE'] as const;
export const ASSET_CONDITION_LABEL = { GOOD: 'Baik', MINOR_DAMAGE: 'Rusak ringan', MAJOR_DAMAGE: 'Rusak berat' } as const;
export const ASSET_STATUSES = ['AVAILABLE', 'LOANED', 'UNDER_MAINTENANCE', 'MISSING', 'DISPOSED'] as const;
export const ASSET_STATUS_LABEL = {
  AVAILABLE: 'Tersedia', LOANED: 'Dipinjam', UNDER_MAINTENANCE: 'Dalam perbaikan', MISSING: 'Tidak ditemukan', DISPOSED: 'Dihapuskan',
} as const;

const money = z.coerce.number({ error: 'Harga harus berupa angka' }).min(0, 'Harga tidak boleh negatif').max(999_999_999_999, 'Harga terlalu besar');
const dateOnly = z
  .string({ error: 'Tanggal wajib diisi' })
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Format tanggal harus YYYY-MM-DD')
  .refine((v) => !Number.isNaN(Date.parse(v)), 'Tanggal tidak valid');
export const dateField = dateOnly;
export const optionalDate = z
  .string()
  .nullish()
  .transform((v) => (v ? v : null))
  .pipe(dateOnly.nullable());

export const registerAssetsSchema = z.object({
  itemId: uuid('Barang'),
  /** Jumlah unit yang didaftarkan sekaligus. Tiap unit mendapat kode dan QR sendiri. */
  quantity: z.coerce.number().int('Jumlah harus bilangan bulat').min(1, 'Minimal 1 unit').max(100, 'Maksimal 100 unit sekali daftar'),
  /** Nomor seri per unit, urut. Boleh kosong; bila diisi jumlahnya harus sama dengan quantity. */
  serialNumbers: z.array(z.string().trim().max(100)).default([]),
  acquisitionDate: optionalDate,
  acquisitionYear: z.coerce.number().int().min(1950, 'Tahun tidak valid').max(2100, 'Tahun tidak valid'),
  fundingSourceId: optionalUuid('Sumber perolehan'),
  vendorId: optionalUuid('Vendor'),
  acquisitionCost: money.default(0),
  condition: z.enum(ASSET_CONDITIONS).default('GOOD'),
  unitId: uuid('Unit pengelola'),
  locationId: uuid('Lokasi'),
  personId: optionalUuid('Penanggung jawab'),
  notes: optionalText('Catatan', 1000),
});
export type RegisterAssetsInput = z.infer<typeof registerAssetsSchema>;

export const updateAssetSchema = z.object({
  serialNumber: z.string().trim().max(100).nullish().transform((v) => v || null),
  acquisitionDate: optionalDate,
  acquisitionYear: z.coerce.number().int().min(1950).max(2100),
  fundingSourceId: optionalUuid('Sumber perolehan'),
  vendorId: optionalUuid('Vendor'),
  acquisitionCost: money,
  notes: optionalText('Catatan', 1000),
  condition: z.enum(ASSET_CONDITIONS),
  /** Wajib diisi bila kondisi berubah. */
  conditionNote: optionalText('Alasan perubahan kondisi', 300),
});
export type UpdateAssetInput = z.infer<typeof updateAssetSchema>;

export const bulkQrSchema = z.object({ assetIds: z.array(uuid('Aset')).min(1, 'Pilih minimal satu aset').max(200, 'Maksimal 200 label sekali cetak') });
