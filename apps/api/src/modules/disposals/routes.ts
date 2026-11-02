import type { FastifyInstance } from 'fastify';
import type { Prisma } from '@prisma/client';
import { disposalSchema, uuid, type DisposalInput } from '@sima/shared';
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

const EDITABLE = ['DRAFT', 'REJECTED'] as const;
const OPEN = ['DRAFT', 'PENDING_APPROVAL', 'APPROVED'] as const;

registerApprovalHandler('DISPOSAL', {
  creatorId: async (tx, id) => (await tx.disposal.findUnique({ where: { id }, select: { createdById: true } }))?.createdById ?? null,
  onApproved: async (tx, { entityId }) => { await tx.disposal.update({ where: { id: entityId }, data: { status: 'APPROVED', approvedAt: new Date() } }); },
  onRejected: async (tx, { entityId }) => { await tx.disposal.update({ where: { id: entityId }, data: { status: 'REJECTED' } }); },
});

async function validate(input: DisposalInput, excludeId?: string) {
  const assets = await prisma.asset.findMany({ where: { id: { in: input.lines.map((l) => l.assetId) } } });
  const busy = await prisma.disposalDetail.findMany({ where: { assetId: { in: assets.map((a) => a.id) }, disposal: { status: { in: [...OPEN] }, ...(excludeId ? { id: { not: excludeId } } : {}) } }, include: { disposal: { select: { number: true } } } });
  const errors: { field: string; message: string }[] = [];
  const STATUS_MSG: Record<string, string> = { LOANED: 'sedang dipinjam', UNDER_MAINTENANCE: 'sedang dalam perbaikan', DISPOSED: 'sudah dihapuskan', MISSING: 'berstatus tidak ditemukan' };
  input.lines.forEach((l, i) => {
    const a = assets.find((x) => x.id === l.assetId);
    if (!a) return void errors.push({ field: `lines.${i}.assetId`, message: 'Aset tidak ditemukan' });
    if (a.status === 'DISPOSED' || a.status === 'LOANED' || a.status === 'UNDER_MAINTENANCE') errors.push({ field: `lines.${i}.assetId`, message: `${a.code} ${STATUS_MSG[a.status]} dan tidak dapat diusulkan hapus` });
    const b = busy.find((x) => x.assetId === a.id);
    if (b) errors.push({ field: `lines.${i}.assetId`, message: `${a.code} sudah ada di penghapusan ${b.disposal.number}` });
  });
  if (errors.length) throw unprocessable('Data penghapusan tidak valid', errors);
  return assets;
}

export async function disposalRoutes(app: FastifyInstance) {
  const idOf = (req: { params: unknown }) => uuid().parse((req.params as { id: string }).id);

  app.get('/disposals', { preHandler: requirePermission('disposals.view') }, async (req) => {
    const q = parseListQuery(req.query, ['number', 'date', 'status', 'createdAt'], 'createdAt', 'desc');
    const f = req.query as Record<string, string | undefined>;
    const where: Prisma.DisposalWhereInput = {
      ...(q.search ? { OR: [{ number: { contains: q.search, mode: 'insensitive' } }, { reason: { contains: q.search, mode: 'insensitive' } }, { details: { some: { asset: { code: { contains: q.search, mode: 'insensitive' } } } } }] } : {}),
      ...(f.status ? { status: f.status as never } : {}),
      ...(f.history === 'true' ? { status: 'COMPLETED' as const } : {}),
    };
    const [rows, total] = await Promise.all([prisma.disposal.findMany({ where, include: { _count: { select: { details: true } } }, orderBy: q.orderBy, skip: q.skip, take: q.take }), prisma.disposal.count({ where })]);
    return paginated(rows.map(({ _count, ...r }) => ({ ...r, assetCount: _count.details })), total, q.page, q.limit);
  });

  app.post('/disposals', { preHandler: requirePermission('disposals.create') }, async (req, reply) => {
    const input = disposalSchema.parse(req.body);
    const auth = currentUser(req);
    const assets = await validate(input);
    assets.forEach((a) => assertUnitAccess(auth, a.unitId));
    const created = await prisma.$transaction(async (tx) => {
      const number = await nextDocNumber(tx, 'PHP', new Date(input.date));
      const d = await tx.disposal.create({
        data: { number, date: new Date(input.date), reason: input.reason, method: input.method, createdById: auth.user.id, details: { create: input.lines.map((l) => ({ assetId: l.assetId, notes: l.notes, lastCondition: assets.find((a) => a.id === l.assetId)!.condition })) } },
        include: { details: true },
      });
      await writeAudit(tx, req, { action: 'CREATE', entityType: 'Disposal', entityId: d.id, after: { number, assets: assets.map((a) => a.code) } });
      return d;
    });
    return reply.code(201).send(ok(created, `Penghapusan ${created.number} dibuat sebagai draft`));
  });

  app.get('/disposals/:id', { preHandler: requirePermission('disposals.view') }, async (req) => {
    const id = idOf(req);
    const d = await prisma.disposal.findUnique({ where: { id }, include: { details: { include: { asset: { select: { id: true, code: true, status: true, disposedAt: true, item: { select: { name: true } }, location: { select: { name: true } } } } } } } });
    if (!d) throw notFound('Penghapusan tidak ditemukan');
    const creator = await prisma.user.findUnique({ where: { id: d.createdById }, select: { name: true } });
    return ok({ ...d, createdByName: creator?.name ?? '-', approval: await approvalTimeline('DISPOSAL', id) });
  });

  app.patch('/disposals/:id', { preHandler: requirePermission('disposals.create') }, async (req) => {
    const id = idOf(req);
    const input = disposalSchema.parse(req.body);
    const assets = await validate(input, id);
    const updated = await prisma.$transaction(async (tx) => {
      await lockRows(tx, 'disposals', [id]);
      const before = await tx.disposal.findUnique({ where: { id } });
      if (!before) throw notFound('Penghapusan tidak ditemukan');
      assertStatus(before.status, EDITABLE, 'Penghapusan yang sudah diajukan atau disetujui tidak dapat diedit langsung');
      await tx.disposalDetail.deleteMany({ where: { disposalId: id } });
      const d = await tx.disposal.update({ where: { id }, data: { date: new Date(input.date), reason: input.reason, method: input.method, status: 'DRAFT', details: { create: input.lines.map((l) => ({ assetId: l.assetId, notes: l.notes, lastCondition: assets.find((a) => a.id === l.assetId)!.condition })) } }, include: { details: true } });
      await writeAudit(tx, req, { action: 'UPDATE', entityType: 'Disposal', entityId: id, before: { reason: before.reason }, after: { reason: d.reason, assets: d.details.length } });
      return d;
    });
    return ok(updated, 'Penghapusan diperbarui');
  });

  app.post('/disposals/:id/submit', { preHandler: requirePermission('disposals.submit') }, async (req) => {
    const id = idOf(req);
    await prisma.$transaction(async (tx) => {
      await lockRows(tx, 'disposals', [id]);
      const d = await tx.disposal.findUnique({ where: { id }, include: { details: true } });
      if (!d) throw notFound('Penghapusan tidak ditemukan');
      assertStatus(d.status, EDITABLE, 'Hanya draft atau penghapusan yang ditolak yang dapat diajukan');
      await tx.disposal.update({ where: { id }, data: { status: 'PENDING_APPROVAL', submittedAt: new Date() } });
      await submitForApproval(tx, req, { entityType: 'DISPOSAL', entityId: id, documentNumber: d.number, title: `Penghapusan ${d.number}: ${d.details.length} aset. ${d.reason}`, requestedById: currentUser(req).user.id });
      await writeAudit(tx, req, { action: 'STATUS_CHANGE', entityType: 'Disposal', entityId: id, before: { status: d.status }, after: { status: 'PENDING_APPROVAL' } });
    });
    return ok(null, 'Penghapusan diajukan untuk persetujuan');
  });

  app.post('/disposals/:id/cancel', { preHandler: requirePermission('disposals.create') }, async (req) => {
    const id = idOf(req);
    await prisma.$transaction(async (tx) => {
      await lockRows(tx, 'disposals', [id]);
      const d = await tx.disposal.findUnique({ where: { id } });
      if (!d) throw notFound('Penghapusan tidak ditemukan');
      assertStatus(d.status, ['DRAFT', 'REJECTED', 'APPROVED'] as const, 'Penghapusan ini tidak dapat dibatalkan pada status sekarang');
      await tx.disposal.update({ where: { id }, data: { status: 'CANCELLED' } });
      await cancelPendingApproval(tx, 'DISPOSAL', id);
      await writeAudit(tx, req, { action: 'STATUS_CHANGE', entityType: 'Disposal', entityId: id, before: { status: d.status }, after: { status: 'CANCELLED' } });
    });
    return ok(null, 'Penghapusan dibatalkan');
  });

  // Finalisasi: aset berstatus DIHAPUSKAN. Tidak ada baris yang dihapus; seluruh histori dan identitas QR tetap.
  app.post('/disposals/:id/complete', { preHandler: requirePermission('disposals.complete') }, async (req) => {
    const id = idOf(req);
    const auth = currentUser(req);
    const codes = await prisma.$transaction(async (tx) => {
      await lockRows(tx, 'disposals', [id]);
      const d = await tx.disposal.findUnique({ where: { id }, include: { details: true } });
      if (!d) throw notFound('Penghapusan tidak ditemukan');
      assertStatus(d.status, ['APPROVED'] as const, 'Finalisasi hanya dapat dilakukan setelah penghapusan disetujui');
      await lockRows(tx, 'assets', d.details.map((x) => x.assetId));
      const done: string[] = [];
      for (const det of d.details) {
        const a = await tx.asset.findUniqueOrThrow({ where: { id: det.assetId } });
        if (a.status !== 'AVAILABLE' && a.status !== 'MISSING') throw conflict(`${a.code} berstatus ${a.status} dan tidak dapat dihapuskan. Selesaikan transaksinya terlebih dahulu.`);
        await tx.asset.update({ where: { id: a.id }, data: { status: 'DISPOSED', disposedAt: new Date() } });
        await tx.assetConditionHistory.create({ data: { assetId: a.id, fromCondition: a.condition, toCondition: a.condition, fromStatus: a.status, toStatus: 'DISPOSED', sourceType: 'DISPOSAL', sourceId: id, note: `Penghapusan ${d.number}: ${d.reason}`, changedById: auth.user.id } });
        done.push(a.code);
      }
      await tx.disposal.update({ where: { id }, data: { status: 'COMPLETED', completedAt: new Date() } });
      await writeAudit(tx, req, { action: 'DISPOSAL_COMPLETE', entityType: 'Disposal', entityId: id, after: { number: d.number, assets: done } });
      await notify(tx, [d.createdById].filter((u) => u !== auth.user.id), { type: 'disposal.completed', title: `Penghapusan ${d.number} difinalisasi`, body: `${done.length} aset dihapuskan`, entityType: 'DISPOSAL', entityId: id });
      return done;
    });
    return ok({ assets: codes }, 'Penghapusan difinalisasi. Histori aset tetap tersimpan.');
  });
}
