import type { FastifyInstance } from 'fastify';
import type { Prisma } from '@prisma/client';
import { stockAdjustmentSchema, uuid } from '@sima/shared';
import { prisma } from '../../lib/prisma';
import { ok, paginated } from '../../lib/respond';
import { notFound, unprocessable } from '../../lib/errors';
import { writeAudit } from '../../lib/audit';
import { assertStatus, lockRows, todayDate } from '../../lib/doc';
import { nextDocNumber } from '../../lib/sequence';
import { parseListQuery } from '../../lib/list';
import { currentUser, requirePermission } from '../../plugins/auth';
import { approvalTimeline, cancelPendingApproval, registerApprovalHandler, submitForApproval } from '../approvals/service';
import { postStockTransaction } from './service';

const EDITABLE = ['DRAFT', 'REJECTED'] as const;

// Ledger yang sudah diposting tidak diedit: koreksi dilakukan lewat penyesuaian yang disetujui,
// dan baru saat disetujui transaksi ADJUSTMENT diposting. Jika stok tidak cukup, persetujuan ikut gagal.
registerApprovalHandler('STOCK_ADJUSTMENT', {
  creatorId: async (tx, id) => (await tx.stockAdjustment.findUnique({ where: { id }, select: { createdById: true } }))?.createdById ?? null,
  onApproved: async (tx, { entityId, actorId, req }) => {
    const adj = await tx.stockAdjustment.findUniqueOrThrow({ where: { id: entityId } });
    const { header } = await postStockTransaction(tx, req, {
      type: 'ADJUSTMENT', date: todayDate(), warehouseId: adj.warehouseId, lines: [{ itemId: adj.itemId, delta: adj.quantityDelta.toString(), notes: adj.reason }],
      sourceType: 'ADJUSTMENT', sourceId: adj.id, notes: `Penyesuaian ${adj.number}: ${adj.reason}`, userId: actorId,
    });
    await tx.stockAdjustment.update({ where: { id: entityId }, data: { status: 'COMPLETED', completedAt: new Date(), transactionId: header.id } });
  },
  onRejected: async (tx, { entityId }) => { await tx.stockAdjustment.update({ where: { id: entityId }, data: { status: 'REJECTED' } }); },
});

export async function stockAdjustmentRoutes(app: FastifyInstance) {
  const idOf = (req: { params: unknown }) => uuid().parse((req.params as { id: string }).id);
  const include = { item: { select: { id: true, code: true, name: true, unitOfMeasure: { select: { name: true } } } }, warehouse: { select: { id: true, name: true } } } satisfies Prisma.StockAdjustmentInclude;

  app.get('/stocks/adjustments', { preHandler: requirePermission('stock_adjustments.view') }, async (req) => {
    const q = parseListQuery(req.query, ['number', 'status', 'createdAt'], 'createdAt', 'desc');
    const f = req.query as Record<string, string | undefined>;
    const where: Prisma.StockAdjustmentWhereInput = {
      ...(q.search ? { OR: [{ number: { contains: q.search, mode: 'insensitive' } }, { item: { name: { contains: q.search, mode: 'insensitive' } } }] } : {}),
      ...(f.status ? { status: f.status as never } : {}),
    };
    const [rows, total] = await Promise.all([prisma.stockAdjustment.findMany({ where, include, orderBy: q.orderBy, skip: q.skip, take: q.take }), prisma.stockAdjustment.count({ where })]);
    return paginated(rows, total, q.page, q.limit);
  });

  app.get('/stocks/adjustments/:id', { preHandler: requirePermission('stock_adjustments.view') }, async (req) => {
    const id = idOf(req);
    const a = await prisma.stockAdjustment.findUnique({ where: { id }, include });
    if (!a) throw notFound('Penyesuaian tidak ditemukan');
    return ok({ ...a, approval: await approvalTimeline('STOCK_ADJUSTMENT', id) });
  });

  app.post('/stocks/adjustments', { preHandler: requirePermission('stock_adjustments.create') }, async (req, reply) => {
    const input = stockAdjustmentSchema.parse(req.body);
    const [item, wh] = await Promise.all([prisma.item.findUnique({ where: { id: input.itemId } }), prisma.warehouse.findUnique({ where: { id: input.warehouseId } })]);
    const errors = [];
    if (!item || item.type !== 'SUPPLY') errors.push({ field: 'itemId', message: 'Pilih barang persediaan' });
    else if (!item.isActive) errors.push({ field: 'itemId', message: 'Barang sudah diarsipkan' });
    if (!wh?.isActive) errors.push({ field: 'warehouseId', message: 'Gudang tidak valid atau nonaktif' });
    if (errors.length) throw unprocessable('Data penyesuaian tidak valid', errors);
    const created = await prisma.$transaction(async (tx) => {
      const number = await nextDocNumber(tx, 'PNY');
      const a = await tx.stockAdjustment.create({ data: { number, itemId: input.itemId, warehouseId: input.warehouseId, quantityDelta: input.quantityDelta, reason: input.reason, createdById: currentUser(req).user.id }, include });
      await writeAudit(tx, req, { action: 'CREATE', entityType: 'StockAdjustment', entityId: a.id, after: { number, delta: String(input.quantityDelta), item: item!.name } });
      return a;
    });
    return reply.code(201).send(ok(created, `Penyesuaian ${created.number} dibuat sebagai draft`));
  });

  app.post('/stocks/adjustments/:id/submit', { preHandler: requirePermission('stock_adjustments.submit') }, async (req) => {
    const id = idOf(req);
    await prisma.$transaction(async (tx) => {
      await lockRows(tx, 'stock_adjustments', [id]);
      const a = await tx.stockAdjustment.findUnique({ where: { id }, include: { item: true } });
      if (!a) throw notFound('Penyesuaian tidak ditemukan');
      assertStatus(a.status, EDITABLE, 'Hanya draft atau penyesuaian yang ditolak yang dapat diajukan');
      await tx.stockAdjustment.update({ where: { id }, data: { status: 'PENDING_APPROVAL', submittedAt: new Date() } });
      await submitForApproval(tx, req, { entityType: 'STOCK_ADJUSTMENT', entityId: id, documentNumber: a.number, title: `Penyesuaian ${a.item.name}: ${a.quantityDelta.isPositive() ? '+' : ''}${a.quantityDelta.toString()}. ${a.reason}`, requestedById: currentUser(req).user.id });
      await writeAudit(tx, req, { action: 'STATUS_CHANGE', entityType: 'StockAdjustment', entityId: id, before: { status: a.status }, after: { status: 'PENDING_APPROVAL' } });
    });
    return ok(null, 'Penyesuaian diajukan untuk persetujuan');
  });

  app.post('/stocks/adjustments/:id/cancel', { preHandler: requirePermission('stock_adjustments.create') }, async (req) => {
    const id = idOf(req);
    await prisma.$transaction(async (tx) => {
      await lockRows(tx, 'stock_adjustments', [id]);
      const a = await tx.stockAdjustment.findUnique({ where: { id } });
      if (!a) throw notFound('Penyesuaian tidak ditemukan');
      assertStatus(a.status, EDITABLE, 'Hanya draft atau penyesuaian yang ditolak yang dapat dibatalkan');
      await tx.stockAdjustment.update({ where: { id }, data: { status: 'CANCELLED' } });
      await cancelPendingApproval(tx, 'STOCK_ADJUSTMENT', id);
      await writeAudit(tx, req, { action: 'STATUS_CHANGE', entityType: 'StockAdjustment', entityId: id, before: { status: a.status }, after: { status: 'CANCELLED' } });
    });
    return ok(null, 'Penyesuaian dibatalkan');
  });
}
