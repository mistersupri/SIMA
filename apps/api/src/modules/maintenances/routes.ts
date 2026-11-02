import type { FastifyInstance } from 'fastify';
import type { Prisma } from '@prisma/client';
import { maintenanceCompleteSchema, maintenanceSchema, uuid } from '@sima/shared';
import { prisma } from '../../lib/prisma';
import { ok, paginated } from '../../lib/respond';
import { conflict, notFound, unprocessable } from '../../lib/errors';
import { writeAudit } from '../../lib/audit';
import { assertStatus, lockRows } from '../../lib/doc';
import { nextDocNumber } from '../../lib/sequence';
import { parseListQuery } from '../../lib/list';
import { assertUnitAccess } from '../../lib/scope';
import { currentUser, requirePermission } from '../../plugins/auth';
import { approvalTimeline, cancelPendingApproval, registerApprovalHandler, submitForApproval } from '../approvals/service';
import { notify } from '../notifications/service';

const EDITABLE = ['REPORTED', 'REJECTED'] as const;
const OPEN = ['REPORTED', 'PENDING_APPROVAL', 'APPROVED', 'IN_PROGRESS'] as const;

registerApprovalHandler('MAINTENANCE', {
  creatorId: async (tx, id) => (await tx.maintenance.findUnique({ where: { id }, select: { createdById: true } }))?.createdById ?? null,
  onApproved: async (tx, { entityId }) => { await tx.maintenance.update({ where: { id: entityId }, data: { status: 'APPROVED' } }); },
  onRejected: async (tx, { entityId }) => { await tx.maintenance.update({ where: { id: entityId }, data: { status: 'REJECTED' } }); },
});

export async function maintenanceRoutes(app: FastifyInstance) {
  const idOf = (req: { params: unknown }) => uuid().parse((req.params as { id: string }).id);
  const include = { asset: { select: { id: true, code: true, status: true, condition: true, item: { select: { name: true } }, location: { select: { name: true } } } }, vendor: { select: { id: true, name: true } } } satisfies Prisma.MaintenanceInclude;

  async function checkAsset(assetId: string, excludeId?: string) {
    const a = await prisma.asset.findUnique({ where: { id: assetId } });
    if (!a) throw unprocessable('Aset tidak ditemukan', [{ field: 'assetId', message: 'Aset tidak ditemukan' }]);
    if (a.status === 'DISPOSED') throw unprocessable('Aset sudah dihapuskan', [{ field: 'assetId', message: `${a.code} sudah dihapuskan` }]);
    const open = await prisma.maintenance.findFirst({ where: { assetId, status: { in: [...OPEN] }, ...(excludeId ? { id: { not: excludeId } } : {}) } });
    if (open) throw unprocessable('Aset sudah memiliki pemeliharaan yang berjalan', [{ field: 'assetId', message: `${a.code} masih memiliki pemeliharaan ${open.number}` }]);
    return a;
  }

  app.get('/maintenances', { preHandler: requirePermission('maintenances.view') }, async (req) => {
    const q = parseListQuery(req.query, ['number', 'date', 'status', 'createdAt', 'cost'], 'createdAt', 'desc');
    const f = req.query as Record<string, string | undefined>;
    const where: Prisma.MaintenanceWhereInput = {
      ...(q.search ? { OR: [{ number: { contains: q.search, mode: 'insensitive' } }, { damageDescription: { contains: q.search, mode: 'insensitive' } }, { asset: { code: { contains: q.search, mode: 'insensitive' } } }] } : {}),
      ...(f.status ? { status: f.status as never } : {}), ...(f.assetId ? { assetId: uuid().parse(f.assetId) } : {}),
      // "Riwayat perbaikan": hanya yang sudah selesai
      ...(f.history === 'true' ? { status: 'COMPLETED' as const } : {}),
    };
    const [rows, total] = await Promise.all([prisma.maintenance.findMany({ where, include, orderBy: q.orderBy, skip: q.skip, take: q.take }), prisma.maintenance.count({ where })]);
    return paginated(rows, total, q.page, q.limit);
  });

  app.post('/maintenances', { preHandler: requirePermission('maintenances.create') }, async (req, reply) => {
    const input = maintenanceSchema.parse(req.body);
    const auth = currentUser(req);
    const asset = await checkAsset(input.assetId);
    assertUnitAccess(auth, asset.unitId);
    const created = await prisma.$transaction(async (tx) => {
      const number = await nextDocNumber(tx, 'PMH', new Date(input.date));
      const m = await tx.maintenance.create({ data: { number, assetId: input.assetId, date: new Date(input.date), type: input.type, damageDescription: input.damageDescription, vendorId: input.vendorId, performerName: input.performerName, createdById: auth.user.id }, include });
      await writeAudit(tx, req, { action: 'CREATE', entityType: 'Maintenance', entityId: m.id, after: { number, asset: asset.code, type: input.type } });
      return m;
    });
    return reply.code(201).send(ok(created, `Pemeliharaan ${created.number} dilaporkan`));
  });

  app.get('/maintenances/:id', { preHandler: requirePermission('maintenances.view') }, async (req) => {
    const id = idOf(req);
    const m = await prisma.maintenance.findUnique({ where: { id }, include });
    if (!m) throw notFound('Pemeliharaan tidak ditemukan');
    const creator = await prisma.user.findUnique({ where: { id: m.createdById }, select: { name: true } });
    return ok({ ...m, createdByName: creator?.name ?? '-', approval: await approvalTimeline('MAINTENANCE', id) });
  });

  app.patch('/maintenances/:id', { preHandler: requirePermission('maintenances.create') }, async (req) => {
    const id = idOf(req);
    const input = maintenanceSchema.parse(req.body);
    await checkAsset(input.assetId, id);
    const updated = await prisma.$transaction(async (tx) => {
      await lockRows(tx, 'maintenances', [id]);
      const before = await tx.maintenance.findUnique({ where: { id } });
      if (!before) throw notFound('Pemeliharaan tidak ditemukan');
      assertStatus(before.status, EDITABLE, 'Pemeliharaan yang sudah diajukan atau disetujui tidak dapat diedit langsung');
      const m = await tx.maintenance.update({ where: { id }, data: { assetId: input.assetId, date: new Date(input.date), type: input.type, damageDescription: input.damageDescription, vendorId: input.vendorId, performerName: input.performerName, status: 'REPORTED' }, include });
      await writeAudit(tx, req, { action: 'UPDATE', entityType: 'Maintenance', entityId: id, before: { damageDescription: before.damageDescription }, after: { damageDescription: m.damageDescription } });
      return m;
    });
    return ok(updated, 'Pemeliharaan diperbarui');
  });

  app.post('/maintenances/:id/submit', { preHandler: requirePermission('maintenances.submit') }, async (req) => {
    const id = idOf(req);
    await prisma.$transaction(async (tx) => {
      await lockRows(tx, 'maintenances', [id]);
      const m = await tx.maintenance.findUnique({ where: { id }, include: { asset: { include: { item: true } } } });
      if (!m) throw notFound('Pemeliharaan tidak ditemukan');
      assertStatus(m.status, EDITABLE, 'Hanya pemeliharaan yang baru dilaporkan atau ditolak yang dapat diajukan');
      if (m.asset.status === 'DISPOSED') throw unprocessable('Aset sudah dihapuskan');
      await tx.maintenance.update({ where: { id }, data: { status: 'PENDING_APPROVAL', submittedAt: new Date() } });
      await submitForApproval(tx, req, { entityType: 'MAINTENANCE', entityId: id, documentNumber: m.number, title: `Pemeliharaan ${m.asset.code} (${m.asset.item.name}): ${m.damageDescription}`, requestedById: currentUser(req).user.id });
      await writeAudit(tx, req, { action: 'STATUS_CHANGE', entityType: 'Maintenance', entityId: id, before: { status: m.status }, after: { status: 'PENDING_APPROVAL' } });
    });
    return ok(null, 'Pemeliharaan diajukan untuk persetujuan');
  });

  app.post('/maintenances/:id/cancel', { preHandler: requirePermission('maintenances.create') }, async (req) => {
    const id = idOf(req);
    await prisma.$transaction(async (tx) => {
      await lockRows(tx, 'maintenances', [id]);
      const m = await tx.maintenance.findUnique({ where: { id } });
      if (!m) throw notFound('Pemeliharaan tidak ditemukan');
      assertStatus(m.status, ['REPORTED', 'REJECTED', 'APPROVED'] as const, 'Pemeliharaan ini tidak dapat dibatalkan pada status sekarang');
      await tx.maintenance.update({ where: { id }, data: { status: 'CANCELLED' } });
      await cancelPendingApproval(tx, 'MAINTENANCE', id);
      await writeAudit(tx, req, { action: 'STATUS_CHANGE', entityType: 'Maintenance', entityId: id, before: { status: m.status }, after: { status: 'CANCELLED' } });
    });
    return ok(null, 'Pemeliharaan dibatalkan');
  });

  // Mulai perbaikan: aset otomatis tidak tersedia (tidak dapat dipinjam atau dimutasi).
  app.post('/maintenances/:id/start', { preHandler: requirePermission('maintenances.complete') }, async (req) => {
    const id = idOf(req);
    const auth = currentUser(req);
    await prisma.$transaction(async (tx) => {
      await lockRows(tx, 'maintenances', [id]);
      const m = await tx.maintenance.findUnique({ where: { id } });
      if (!m) throw notFound('Pemeliharaan tidak ditemukan');
      assertStatus(m.status, ['APPROVED'] as const, 'Perbaikan hanya dapat dimulai setelah pemeliharaan disetujui');
      await lockRows(tx, 'assets', [m.assetId]);
      const a = await tx.asset.findUniqueOrThrow({ where: { id: m.assetId } });
      if (a.status !== 'AVAILABLE') throw conflict(`${a.code} berstatus ${a.status} dan tidak dapat mulai diperbaiki. Selesaikan atau kembalikan terlebih dahulu.`);
      await tx.asset.update({ where: { id: a.id }, data: { status: 'UNDER_MAINTENANCE' } });
      await tx.assetConditionHistory.create({ data: { assetId: a.id, fromCondition: a.condition, toCondition: a.condition, fromStatus: 'AVAILABLE', toStatus: 'UNDER_MAINTENANCE', sourceType: 'MAINTENANCE', sourceId: id, note: `Pemeliharaan ${m.number}: ${m.damageDescription}`, changedById: auth.user.id } });
      await tx.maintenance.update({ where: { id }, data: { status: 'IN_PROGRESS', startedAt: new Date() } });
      await writeAudit(tx, req, { action: 'MAINTENANCE_START', entityType: 'Maintenance', entityId: id, after: { number: m.number, asset: a.code } });
    });
    return ok(null, 'Perbaikan dimulai, aset berstatus dalam perbaikan');
  });

  app.post('/maintenances/:id/complete', { preHandler: requirePermission('maintenances.complete') }, async (req) => {
    const id = idOf(req);
    const auth = currentUser(req);
    const input = maintenanceCompleteSchema.parse(req.body);
    await prisma.$transaction(async (tx) => {
      await lockRows(tx, 'maintenances', [id]);
      const m = await tx.maintenance.findUnique({ where: { id } });
      if (!m) throw notFound('Pemeliharaan tidak ditemukan');
      assertStatus(m.status, ['IN_PROGRESS'] as const, 'Hanya perbaikan yang sedang berjalan yang dapat diselesaikan');
      await lockRows(tx, 'assets', [m.assetId]);
      const a = await tx.asset.findUniqueOrThrow({ where: { id: m.assetId } });
      await tx.asset.update({ where: { id: a.id }, data: { status: 'AVAILABLE', condition: input.resultingCondition } });
      await tx.assetConditionHistory.create({ data: { assetId: a.id, fromCondition: a.condition, toCondition: input.resultingCondition, fromStatus: 'UNDER_MAINTENANCE', toStatus: 'AVAILABLE', sourceType: 'MAINTENANCE', sourceId: id, note: input.actionTaken, changedById: auth.user.id } });
      await tx.maintenance.update({ where: { id }, data: { status: 'COMPLETED', completedAt: new Date(), actionTaken: input.actionTaken, cost: input.cost, resultingCondition: input.resultingCondition } });
      await writeAudit(tx, req, { action: 'MAINTENANCE_COMPLETE', entityType: 'Maintenance', entityId: id, after: { number: m.number, cost: String(input.cost), condition: input.resultingCondition } });
      await notify(tx, [m.createdById].filter((u) => u !== auth.user.id), { type: 'maintenance.completed', title: `Pemeliharaan ${m.number} selesai`, body: `${a.code} kembali tersedia`, entityType: 'MAINTENANCE', entityId: id });
    });
    return ok(null, 'Pemeliharaan selesai, aset kembali tersedia');
  });
}
