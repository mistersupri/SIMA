import { z } from 'zod';
import { ASSET_CONDITIONS, dateField } from './items';
import { optionalText, optionalUuid, requiredText, uuid } from './common';

const qty = z.coerce.number({ error: 'Jumlah harus berupa angka' }).positive('Jumlah harus lebih dari 0').max(999_999_999, 'Jumlah terlalu besar');
const price = z.coerce.number({ error: 'Harga harus berupa angka' }).min(0, 'Harga tidak boleh negatif').max(999_999_999_999, 'Harga terlalu besar');

const noDuplicates = <T extends Record<string, unknown>>(key: keyof T & string, message: string) => (rows: T[], ctx: z.RefinementCtx) => {
  const seen = new Set<unknown>();
  rows.forEach((r, i) => {
    if (seen.has(r[key])) ctx.addIssue({ code: 'custom', path: [i, key], message });
    seen.add(r[key]);
  });
};

// ---------------------------------------------------------------- approval

export const APPROVAL_ENTITIES = ['PROCUREMENT', 'MUTATION', 'LOAN', 'MAINTENANCE', 'STOCK_ADJUSTMENT', 'DISPOSAL'] as const;
export type ApprovalEntityType = (typeof APPROVAL_ENTITIES)[number];

/** Modul permission untuk keputusan: `<modul>.approve` dan `<modul>.reject`. */
export const APPROVAL_MODULE: Record<ApprovalEntityType, string> = {
  PROCUREMENT: 'procurements', MUTATION: 'mutations', LOAN: 'loans', MAINTENANCE: 'maintenances',
  STOCK_ADJUSTMENT: 'stock_adjustments', DISPOSAL: 'disposals',
};
export const APPROVAL_ENTITY_LABEL: Record<ApprovalEntityType, string> = {
  PROCUREMENT: 'Pengadaan', MUTATION: 'Mutasi', LOAN: 'Peminjaman', MAINTENANCE: 'Pemeliharaan', STOCK_ADJUSTMENT: 'Penyesuaian stok', DISPOSAL: 'Penghapusan',
};

export const approveSchema = z.object({ note: optionalText('Catatan', 500) });
export const rejectSchema = z.object({ note: requiredText('Alasan penolakan', 500) });

// ---------------------------------------------------------------- pengadaan

export const procurementSchema = z.object({
  date: dateField,
  fiscalYear: z.coerce.number().int().min(2000, 'Tahun anggaran tidak valid').max(2100, 'Tahun anggaran tidak valid'),
  vendorId: uuid('Vendor'),
  fundingSourceId: optionalUuid('Sumber dana'),
  notes: optionalText('Catatan', 500),
  lines: z.array(z.object({ itemId: uuid('Barang'), quantity: qty, unitPrice: price, notes: optionalText('Catatan', 200) }))
    .min(1, 'Tambahkan minimal satu barang').max(100, 'Maksimal 100 baris').superRefine(noDuplicates('itemId', 'Barang yang sama muncul lebih dari sekali')),
});
export type ProcurementInput = z.infer<typeof procurementSchema>;

export const PROCUREMENT_STATUS_LABEL = {
  DRAFT: 'Draft', PENDING_APPROVAL: 'Menunggu persetujuan', APPROVED: 'Disetujui', REJECTED: 'Ditolak',
  PARTIALLY_RECEIVED: 'Diterima sebagian', COMPLETED: 'Selesai', CANCELLED: 'Dibatalkan',
} as const;

export const goodsReceiptSchema = z.object({
  receivedDate: dateField,
  warehouseId: optionalUuid('Gudang'),
  assetUnitId: optionalUuid('Unit pengelola'),
  assetLocationId: optionalUuid('Lokasi'),
  assetPersonId: optionalUuid('Penanggung jawab'),
  notes: optionalText('Catatan', 500),
  lines: z.array(z.object({
    procurementDetailId: uuid('Detail pengadaan'),
    quantityReceived: qty,
    serialNumbers: z.array(z.string().trim().max(100)).default([]),
  })).min(1, 'Isi minimal satu barang yang diterima').superRefine(noDuplicates('procurementDetailId', 'Baris pengadaan yang sama muncul lebih dari sekali')),
});
export type GoodsReceiptInput = z.infer<typeof goodsReceiptSchema>;

// ---------------------------------------------------------------- mutasi

export const mutationSchema = z.object({
  date: dateField,
  reason: requiredText('Alasan mutasi', 500),
  lines: z.array(z.object({ assetId: uuid('Aset'), toUnitId: uuid('Unit tujuan'), toLocationId: uuid('Lokasi tujuan'), toPersonId: optionalUuid('Penanggung jawab baru') }))
    .min(1, 'Pilih minimal satu aset').max(100, 'Maksimal 100 aset').superRefine(noDuplicates('assetId', 'Aset yang sama muncul lebih dari sekali')),
});
export type MutationInput = z.infer<typeof mutationSchema>;
export const MUTATION_STATUS_LABEL = {
  DRAFT: 'Draft', PENDING_APPROVAL: 'Menunggu persetujuan', APPROVED: 'Disetujui', REJECTED: 'Ditolak',
  IN_TRANSFER: 'Pemindahan dilakukan', COMPLETED: 'Selesai', CANCELLED: 'Dibatalkan',
} as const;

// ---------------------------------------------------------------- peminjaman

export const loanSchema = z.object({
  borrowerPersonId: uuid('Peminjam'),
  unitId: optionalUuid('Unit kerja'),
  loanDate: dateField,
  expectedReturnDate: dateField,
  purpose: requiredText('Keperluan', 500),
  assetIds: z.array(uuid('Aset')).min(1, 'Pilih minimal satu aset').max(50, 'Maksimal 50 aset').refine((a) => new Set(a).size === a.length, 'Aset yang sama dipilih lebih dari sekali'),
}).refine((v) => v.expectedReturnDate >= v.loanDate, { path: ['expectedReturnDate'], message: 'Tanggal pengembalian tidak boleh sebelum tanggal pinjam' });
export type LoanInput = z.infer<typeof loanSchema>;

export const loanReturnSchema = z.object({
  returns: z.array(z.object({ assetId: uuid('Aset'), conditionAfter: z.enum(ASSET_CONDITIONS, { error: 'Kondisi wajib dipilih' }), notes: optionalText('Catatan', 300) })).min(1, 'Pilih minimal satu aset yang dikembalikan'),
});
export const LOAN_STATUS_LABEL = {
  DRAFT: 'Draft', PENDING_APPROVAL: 'Menunggu persetujuan', APPROVED: 'Disetujui', REJECTED: 'Ditolak',
  ACTIVE: 'Dipinjam', RETURNED: 'Dikembalikan', OVERDUE: 'Terlambat', CANCELLED: 'Dibatalkan',
} as const;

// ---------------------------------------------------------------- penyesuaian stok

export const stockAdjustmentSchema = z.object({
  itemId: uuid('Barang'),
  warehouseId: uuid('Gudang'),
  quantityDelta: z.coerce.number({ error: 'Selisih harus berupa angka' }).refine((v) => v !== 0, 'Selisih tidak boleh 0').refine((v) => Math.abs(v) <= 999_999_999, 'Nilai terlalu besar'),
  reason: requiredText('Alasan penyesuaian', 500),
});
export type StockAdjustmentInput = z.infer<typeof stockAdjustmentSchema>;
export const DOC_STATUS_LABEL = { DRAFT: 'Draft', PENDING_APPROVAL: 'Menunggu persetujuan', APPROVED: 'Disetujui', REJECTED: 'Ditolak', COMPLETED: 'Selesai', CANCELLED: 'Dibatalkan' } as const;

/** Rute UI untuk dokumen yang diminta persetujuan (dipakai tautan notifikasi dan daftar persetujuan). */
export const approvalEntityPath = (type: ApprovalEntityType, id: string) =>
  ({ PROCUREMENT: `/pengadaan/${id}`, MUTATION: `/mutasi/${id}`, LOAN: `/peminjaman/${id}`, MAINTENANCE: `/pemeliharaan/${id}`, STOCK_ADJUSTMENT: '/persediaan/penyesuaian', DISPOSAL: `/penghapusan/${id}` })[type];

// ---------------------------------------------------------------- pemeliharaan

export const MAINTENANCE_TYPES = ['PREVENTIVE', 'CORRECTIVE'] as const;
export const MAINTENANCE_TYPE_LABEL = { PREVENTIVE: 'Pencegahan', CORRECTIVE: 'Perbaikan' } as const;
export const MAINTENANCE_STATUS_LABEL = {
  REPORTED: 'Dilaporkan', PENDING_APPROVAL: 'Menunggu persetujuan', APPROVED: 'Disetujui', IN_PROGRESS: 'Dalam perbaikan',
  COMPLETED: 'Selesai', REJECTED: 'Ditolak', CANCELLED: 'Dibatalkan',
} as const;

export const maintenanceSchema = z.object({
  assetId: uuid('Aset'),
  date: dateField,
  type: z.enum(MAINTENANCE_TYPES, { error: 'Jenis pemeliharaan wajib dipilih' }),
  damageDescription: requiredText('Deskripsi kerusakan/keperluan', 1000),
  vendorId: optionalUuid('Vendor'),
  performerName: optionalText('Pelaksana', 150),
});
export type MaintenanceInput = z.infer<typeof maintenanceSchema>;

export const maintenanceCompleteSchema = z.object({
  actionTaken: requiredText('Tindakan perbaikan', 1000),
  cost: z.coerce.number({ error: 'Biaya harus berupa angka' }).min(0, 'Biaya tidak boleh negatif').max(999_999_999_999, 'Biaya terlalu besar').default(0),
  resultingCondition: z.enum(ASSET_CONDITIONS, { error: 'Kondisi setelah perbaikan wajib dipilih' }),
});

// ---------------------------------------------------------------- penghapusan

export const DISPOSAL_METHODS = ['SOLD', 'DESTROYED', 'GRANTED', 'TRANSFERRED', 'OTHER'] as const;
export const DISPOSAL_METHOD_LABEL = { SOLD: 'Dijual', DESTROYED: 'Dimusnahkan', GRANTED: 'Dihibahkan', TRANSFERRED: 'Dialihkan', OTHER: 'Lainnya' } as const;

export const disposalSchema = z.object({
  date: dateField,
  reason: requiredText('Alasan penghapusan', 1000),
  method: z.enum(DISPOSAL_METHODS, { error: 'Cara penghapusan wajib dipilih' }),
  lines: z.array(z.object({ assetId: uuid('Aset'), notes: optionalText('Catatan', 300) }))
    .min(1, 'Pilih minimal satu aset').max(100, 'Maksimal 100 aset').superRefine(noDuplicates('assetId', 'Aset yang sama muncul lebih dari sekali')),
});
export type DisposalInput = z.infer<typeof disposalSchema>;

// ---------------------------------------------------------------- stock opname

export const OPNAME_STATUS_LABEL = { DRAFT: 'Draft', IN_PROGRESS: 'Sedang diperiksa', SUBMITTED: 'Menunggu verifikasi', VERIFIED: 'Terverifikasi', CANCELLED: 'Dibatalkan' } as const;
export const OPNAME_RESULTS = ['MATCH', 'MISMATCH', 'NOT_FOUND', 'NOT_CHECKED', 'UNREGISTERED'] as const;
export const OPNAME_RESULT_LABEL = { MATCH: 'Sesuai', MISMATCH: 'Tidak sesuai', NOT_FOUND: 'Tidak ditemukan', NOT_CHECKED: 'Belum diperiksa', UNREGISTERED: 'Barang tidak terdaftar' } as const;

export const opnameSchema = z.object({
  title: requiredText('Judul', 200),
  periodStart: dateField,
  periodEnd: dateField,
  locationId: optionalUuid('Lokasi'),
  unitId: optionalUuid('Unit kerja'),
  notes: optionalText('Catatan', 500),
  assigneeIds: z.array(uuid('Petugas')).min(1, 'Tetapkan minimal satu petugas pemeriksa').max(20),
}).refine((v) => v.periodEnd >= v.periodStart, { path: ['periodEnd'], message: 'Periode berakhir tidak boleh sebelum mulai' })
  .refine((v) => v.locationId || v.unitId, { path: ['locationId'], message: 'Tentukan lokasi atau unit kerja yang diperiksa' });
export type OpnameInput = z.infer<typeof opnameSchema>;

/** Satu catatan hasil pemeriksaan. `clientId` dibuat perangkat agar sinkronisasi ulang tidak menggandakan data. */
export const opnameScanSchema = z.object({
  clientId: z.string().uuid('ID perangkat tidak valid'),
  clientRecordedAt: z.string().datetime({ offset: true }).optional(),
  code: requiredText('Kode aset', 100),
  foundLocationId: optionalUuid('Lokasi ditemukan'),
  foundCondition: z.enum(ASSET_CONDITIONS).nullish().transform((v) => v ?? null),
  notes: optionalText('Catatan', 500),
});
export type OpnameScanInput = z.infer<typeof opnameScanSchema>;
export const opnameSyncSchema = z.object({ records: z.array(opnameScanSchema).min(1).max(500) });

export const opnameSubmitSchema = z.object({ markUncheckedAsNotFound: z.boolean().default(false) });
export const opnameVerifySchema = z.object({
  note: optionalText('Catatan verifikasi', 500),
  decisions: z.array(z.object({ detailId: uuid('Detail'), decision: z.enum(['APPLY', 'REJECT'], { error: 'Keputusan wajib dipilih' }) })).default([]),
});
