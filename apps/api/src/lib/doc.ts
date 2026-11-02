import type { Prisma } from '@prisma/client';
import { unprocessable } from './errors';

type Tx = Prisma.TransactionClient;
type LockTable = 'assets' | 'procurements' | 'procurement_details' | 'goods_receipts' | 'asset_mutations' | 'loans' | 'stock_adjustments' | 'approval_requests' | 'maintenances' | 'disposals' | 'stock_opnames' | 'import_batches';

/** Kunci baris (SELECT ... FOR UPDATE) berurutan per id agar transaksi serentak tidak deadlock. */
export async function lockRows(tx: Tx, table: LockTable, ids: string[]) {
  if (!ids.length) return;
  await tx.$queryRawUnsafe(`SELECT id FROM "${table}" WHERE id = ANY($1::uuid[]) ORDER BY id FOR UPDATE`, [...new Set(ids)]);
}

export function assertStatus<S extends string>(current: S, allowed: readonly S[], message: string) {
  if (!allowed.includes(current)) throw unprocessable(message);
}

export const dateOnly = (iso: string) => new Date(iso);
export const todayDate = () => new Date(new Date().toISOString().slice(0, 10));
