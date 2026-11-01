import { Prisma } from '@prisma/client';
import type { StockTxType } from '@prisma/client';
import { nextDocNumber } from '../../lib/sequence';
import { unprocessable } from '../../lib/errors';
import { writeAudit } from '../../lib/audit';
import type { FastifyRequest } from 'fastify';
import { notify, usersWithPermission } from '../notifications/service';

type Tx = Prisma.TransactionClient;

export interface StockLine {
  itemId: string;
  /** Positif = masuk, negatif = keluar. */
  delta: number | string;
  unitCost?: number | null;
  notes?: string | null;
}

export interface PostStockInput {
  type: StockTxType;
  date: Date;
  warehouseId: string;
  lines: StockLine[];
  unitId?: string | null;
  personId?: string | null;
  sourceType?: string | null;
  sourceId?: string | null;
  notes?: string | null;
  userId: string;
}

const PREFIX: Record<StockTxType, string> = { OPENING: 'SAW', IN: 'BM', OUT: 'BK', ADJUSTMENT: 'ADJ' };

/**
 * Satu-satunya jalan mengubah saldo persediaan. Harus dipanggil di dalam transaksi database.
 * Setiap baris: kunci saldo (SELECT ... FOR UPDATE), hitung saldo baru, tolak bila negatif,
 * lalu tulis baris ledger. Urutan kunci per itemId mencegah deadlock antar transaksi serentak.
 */
export async function postStockTransaction(tx: Tx, req: FastifyRequest | null, input: PostStockInput) {
  const warehouse = await tx.warehouse.findUnique({ where: { id: input.warehouseId } });
  if (!warehouse || !warehouse.isActive) throw unprocessable('Gudang tidak valid atau nonaktif', [{ field: 'warehouseId', message: 'Gudang tidak valid atau nonaktif' }]);

  const indexed = input.lines.map((l, index) => ({ ...l, index })).sort((a, b) => a.itemId.localeCompare(b.itemId));
  const items = await tx.item.findMany({ where: { id: { in: indexed.map((l) => l.itemId) } } });
  const itemById = new Map(items.map((i) => [i.id, i]));

  const number = await nextDocNumber(tx, PREFIX[input.type], input.date);
  const header = await tx.stockTransaction.create({
    data: {
      number, type: input.type, date: input.date, warehouseId: input.warehouseId,
      unitId: input.unitId ?? null, personId: input.personId ?? null,
      sourceType: input.sourceType ?? 'MANUAL', sourceId: input.sourceId ?? null,
      notes: input.notes ?? null, createdById: input.userId,
    },
  });

  const results: { itemId: string; before: string; after: string }[] = [];
  for (const line of indexed) {
    const item = itemById.get(line.itemId);
    const field = `lines.${line.index}.itemId`;
    if (!item) throw unprocessable('Barang tidak ditemukan', [{ field, message: 'Barang tidak ditemukan' }]);
    if (item.type !== 'SUPPLY') throw unprocessable('Hanya barang persediaan yang memiliki stok', [{ field, message: `${item.name} bukan barang persediaan` }]);
    if (!item.isActive) throw unprocessable('Barang sudah diarsipkan', [{ field, message: `${item.name} sudah diarsipkan` }]);

    await tx.$executeRaw`
      INSERT INTO stock_balances ("id", "itemId", "warehouseId", "quantity", "updatedAt")
      VALUES (gen_random_uuid(), ${line.itemId}::uuid, ${input.warehouseId}::uuid, 0, now())
      ON CONFLICT ("itemId", "warehouseId") DO NOTHING`;
    const [row] = await tx.$queryRaw<{ quantity: Prisma.Decimal }[]>`
      SELECT "quantity" FROM stock_balances
      WHERE "itemId" = ${line.itemId}::uuid AND "warehouseId" = ${input.warehouseId}::uuid FOR UPDATE`;

    const before = new Prisma.Decimal(row!.quantity);
    const delta = new Prisma.Decimal(line.delta);
    const after = before.plus(delta);
    if (after.isNegative()) {
      throw unprocessable('Stok tidak mencukupi', [
        { field: `lines.${line.index}.quantity`, message: `Stok ${item.name} tidak mencukupi. Tersedia ${before.toString()}, diminta ${delta.abs().toString()}` },
      ]);
    }

    await tx.stockBalance.update({ where: { itemId_warehouseId: { itemId: line.itemId, warehouseId: input.warehouseId } }, data: { quantity: after } });
    await tx.stockTransactionDetail.create({
      data: {
        transactionId: header.id, itemId: line.itemId, warehouseId: input.warehouseId,
        quantityIn: delta.isPositive() ? delta : 0, quantityOut: delta.isNegative() ? delta.abs() : 0,
        balanceAfter: after, unitCost: line.unitCost ?? null, notes: line.notes ?? null,
      },
    });
    results.push({ itemId: line.itemId, before: before.toString(), after: after.toString() });

    // Peringatan stok menipis (sekali per barang per hari) saat total saldo turun di bawah minimum.
    if (delta.isNegative() && item.minStock.gt(0)) {
      const sum = await tx.stockBalance.aggregate({ where: { itemId: item.id }, _sum: { quantity: true } });
      if ((sum._sum.quantity ?? new Prisma.Decimal(0)).lt(item.minStock)) {
        const recipients = await usersWithPermission(tx, 'stocks.in');
        await notify(tx, recipients, {
          type: 'stock.low', title: `Stok menipis: ${item.name}`, body: `Total saldo ${(sum._sum.quantity ?? 0).toString()}, minimum ${item.minStock.toString()}`,
          entityType: 'ITEM', entityId: item.id, dedupeKey: `lowstock:${item.id}:${input.date.toISOString().slice(0, 10)}`,
        });
      }
    }
  }

  await writeAudit(tx, req, {
    action: `STOCK_${input.type}`, entityType: 'StockTransaction', entityId: header.id,
    after: { number, type: input.type, warehouseId: input.warehouseId, lines: results },
    userId: input.userId,
  });
  return { header, results };
}
