import type { FastifyInstance } from 'fastify';
import { Prisma } from '@prisma/client';
import { stockInSchema, stockOutSchema, uuid } from '@sima/shared';
import { prisma } from '../../lib/prisma';
import { ok, paginated } from '../../lib/respond';
import { notFound, unprocessable } from '../../lib/errors';
import { parseListQuery, parseBool } from '../../lib/list';
import { currentUser, requirePermission } from '../../plugins/auth';
import { postStockTransaction } from './service';

const day = (s?: string) => (s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? new Date(s) : undefined);

export async function stockRoutes(app: FastifyInstance) {
  app.get('/stocks', { preHandler: requirePermission('stocks.view') }, async (req) => {
    const q = parseListQuery(req.query, ['code', 'name', 'minStock'], 'name');
    const f = req.query as Record<string, string | undefined>;
    const warehouseId = f.warehouseId ? uuid('Gudang').parse(f.warehouseId) : undefined;
    const where: Prisma.ItemWhereInput = {
      type: 'SUPPLY', isActive: true,
      ...(q.search ? { OR: [{ name: { contains: q.search, mode: 'insensitive' } }, { code: { contains: q.search, mode: 'insensitive' } }] } : {}),
      ...(f.categoryId ? { categoryId: uuid('Kategori').parse(f.categoryId) } : {}),
    };
    if (parseBool(f.belowMin)) {
      const rows = await prisma.$queryRaw<{ id: string }[]>`
        SELECT i.id FROM items i LEFT JOIN stock_balances b ON b."itemId" = i.id
          AND (${warehouseId ?? null}::uuid IS NULL OR b."warehouseId" = ${warehouseId ?? null}::uuid)
        WHERE i.type = 'SUPPLY' AND i."isActive" AND i."minStock" > 0
        GROUP BY i.id HAVING COALESCE(SUM(b.quantity), 0) < i."minStock"`;
      where.id = { in: rows.map((r) => r.id) };
    }
    const [items, total] = await Promise.all([
      prisma.item.findMany({ where, include: { category: { select: { name: true } }, unitOfMeasure: { select: { code: true, name: true } } }, orderBy: q.orderBy, skip: q.skip, take: q.take }),
      prisma.item.count({ where }),
    ]);
    const balances = await prisma.stockBalance.findMany({ where: { itemId: { in: items.map((i) => i.id) }, ...(warehouseId ? { warehouseId } : {}) }, include: { warehouse: { select: { id: true, name: true } } } });
    return paginated(items.map((item) => {
      const bs = balances.filter((b) => b.itemId === item.id);
      const total = bs.reduce((s, b) => s.plus(b.quantity), new Prisma.Decimal(0));
      return {
        item: { id: item.id, code: item.code, name: item.name, category: item.category.name, unit: item.unitOfMeasure.name, minStock: item.minStock.toString() },
        quantity: total.toString(), belowMin: item.minStock.gt(0) && total.lt(item.minStock),
        balances: bs.map((b) => ({ warehouseId: b.warehouseId, warehouse: b.warehouse.name, quantity: b.quantity.toString() })),
      };
    }), total, q.page, q.limit);
  });

  app.get('/stocks/transactions', { preHandler: requirePermission('stocks.view') }, async (req) => {
    const q = parseListQuery(req.query, ['date', 'number', 'postedAt'], 'postedAt', 'desc');
    const f = req.query as Record<string, string | undefined>;
    const where: Prisma.StockTransactionWhereInput = {
      ...(f.type && ['OPENING', 'IN', 'OUT', 'ADJUSTMENT'].includes(f.type) ? { type: f.type as never } : {}),
      ...(f.warehouseId ? { warehouseId: uuid().parse(f.warehouseId) } : {}),
      ...(f.itemId ? { details: { some: { itemId: uuid().parse(f.itemId) } } } : {}),
      ...(day(f.from) || day(f.to) ? { date: { gte: day(f.from), lte: day(f.to) } } : {}),
      ...(q.search ? { OR: [{ number: { contains: q.search, mode: 'insensitive' } }, { notes: { contains: q.search, mode: 'insensitive' } }] } : {}),
    };
    const [rows, total] = await Promise.all([
      prisma.stockTransaction.findMany({ where, include: { warehouse: { select: { name: true } }, person: { select: { name: true } }, details: { include: { item: { select: { code: true, name: true } } } } }, orderBy: q.orderBy, skip: q.skip, take: q.take }),
      prisma.stockTransaction.count({ where }),
    ]);
    return paginated(rows.map((t) => ({
      id: t.id, number: t.number, type: t.type, date: t.date, warehouse: t.warehouse.name, person: t.person?.name ?? null, notes: t.notes, postedAt: t.postedAt,
      lines: t.details.map((d) => ({ itemCode: d.item.code, itemName: d.item.name, in: d.quantityIn.toString(), out: d.quantityOut.toString(), balanceAfter: d.balanceAfter.toString() })),
    })), total, q.page, q.limit);
  });

  app.get('/stocks/:itemId', { preHandler: requirePermission('stocks.view') }, async (req) => {
    const itemId = uuid('Barang').parse((req.params as { itemId: string }).itemId);
    const item = await prisma.item.findUnique({ where: { id: itemId }, include: { category: true, unitOfMeasure: true, balances: { include: { warehouse: true } } } });
    if (!item || item.type !== 'SUPPLY') throw notFound('Barang persediaan tidak ditemukan');
    const total = item.balances.reduce((s, b) => s.plus(b.quantity), new Prisma.Decimal(0));
    return ok({
      id: item.id, code: item.code, name: item.name, category: item.category.name, unit: item.unitOfMeasure.name, minStock: item.minStock.toString(),
      quantity: total.toString(), belowMin: item.minStock.gt(0) && total.lt(item.minStock),
      balances: item.balances.map((b) => ({ warehouseId: b.warehouseId, warehouse: b.warehouse.name, quantity: b.quantity.toString() })),
    });
  });

  app.get('/stocks/:itemId/card', { preHandler: requirePermission('stocks.view') }, async (req) => {
    const itemId = uuid('Barang').parse((req.params as { itemId: string }).itemId);
    const f = req.query as Record<string, string | undefined>;
    if (!f.warehouseId) throw unprocessable('Pilih gudang untuk kartu stok', [{ field: 'warehouseId', message: 'Gudang wajib dipilih' }]);
    const warehouseId = uuid('Gudang').parse(f.warehouseId);
    const q = parseListQuery(req.query, [], 'seq');
    const from = day(f.from), to = day(f.to);
    const where: Prisma.StockTransactionDetailWhereInput = { itemId, warehouseId, ...(from || to ? { transaction: { date: { gte: from, lte: to } } } : {}) };
    const [rows, total, prior] = await Promise.all([
      prisma.stockTransactionDetail.findMany({ where, include: { transaction: { select: { number: true, type: true, date: true, notes: true } } }, orderBy: { seq: 'asc' }, skip: q.skip, take: q.take }),
      prisma.stockTransactionDetail.count({ where }),
      from ? prisma.stockTransactionDetail.findFirst({ where: { itemId, warehouseId, transaction: { date: { lt: from } } }, orderBy: { seq: 'desc' } }) : null,
    ]);
    const lines = rows.map((d) => ({ id: d.id, date: d.transaction.date, number: d.transaction.number, type: d.transaction.type, notes: d.notes ?? d.transaction.notes, in: d.quantityIn.toString(), out: d.quantityOut.toString(), balance: d.balanceAfter.toString() }));
    return { ...paginated(lines, total, q.page, q.limit), openingBalance: prior?.balanceAfter.toString() ?? '0' };
  });

  app.post('/stocks/in', { preHandler: requirePermission('stocks.in') }, async (req, reply) => {
    const input = stockInSchema.parse(req.body);
    const result = await prisma.$transaction((tx) => postStockTransaction(tx, req, {
      type: 'IN', date: new Date(input.date), warehouseId: input.warehouseId, notes: input.notes,
      lines: input.lines.map((l) => ({ itemId: l.itemId, delta: l.quantity, unitCost: l.unitCost, notes: l.notes })), userId: currentUser(req).user.id,
    }));
    return reply.code(201).send(ok({ id: result.header.id, number: result.header.number, balances: result.results }, `Barang masuk ${result.header.number} tercatat`));
  });

  app.post('/stocks/out', { preHandler: requirePermission('stocks.out') }, async (req, reply) => {
    const input = stockOutSchema.parse(req.body);
    const result = await prisma.$transaction((tx) => postStockTransaction(tx, req, {
      type: 'OUT', date: new Date(input.date), warehouseId: input.warehouseId, unitId: input.unitId, personId: input.personId, notes: input.notes,
      lines: input.lines.map((l) => ({ itemId: l.itemId, delta: -l.quantity, notes: l.notes })), userId: currentUser(req).user.id,
    }));
    return reply.code(201).send(ok({ id: result.header.id, number: result.header.number, balances: result.results }, `Barang keluar ${result.header.number} tercatat`));
  });
}
