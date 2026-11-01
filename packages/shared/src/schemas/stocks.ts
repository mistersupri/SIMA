import { z } from 'zod';
import { dateField, } from './items';
import { optionalText, optionalUuid, uuid } from './common';

const qty = z.coerce.number({ error: 'Jumlah harus berupa angka' }).positive('Jumlah harus lebih dari 0').max(999_999_999, 'Jumlah terlalu besar');

const line = z.object({
  itemId: uuid('Barang'),
  quantity: qty,
  unitCost: z.coerce.number().min(0, 'Harga tidak boleh negatif').nullish().transform((v) => v ?? null),
  notes: optionalText('Catatan', 200),
});

const lines = z.array(line).min(1, 'Tambahkan minimal satu barang').max(100, 'Maksimal 100 baris').superRefine((rows, ctx) => {
  const seen = new Set<string>();
  rows.forEach((r, i) => {
    if (seen.has(r.itemId)) ctx.addIssue({ code: 'custom', path: [i, 'itemId'], message: 'Barang yang sama muncul lebih dari sekali' });
    seen.add(r.itemId);
  });
});

export const stockInSchema = z.object({
  warehouseId: uuid('Gudang'),
  date: dateField,
  notes: optionalText('Catatan', 300),
  lines,
});
export type StockInInput = z.infer<typeof stockInSchema>;

export const stockOutSchema = z.object({
  warehouseId: uuid('Gudang'),
  date: dateField,
  unitId: optionalUuid('Unit penerima'),
  personId: optionalUuid('Penerima'),
  notes: optionalText('Keperluan', 300),
  lines,
});
export type StockOutInput = z.infer<typeof stockOutSchema>;

export const STOCK_TX_TYPES = ['OPENING', 'IN', 'OUT', 'ADJUSTMENT'] as const;
export const STOCK_TX_LABEL = { OPENING: 'Saldo awal', IN: 'Barang masuk', OUT: 'Barang keluar', ADJUSTMENT: 'Penyesuaian' } as const;
