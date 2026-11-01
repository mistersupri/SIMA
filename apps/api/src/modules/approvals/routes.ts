import type { FastifyInstance } from 'fastify';
import type { Prisma } from '@prisma/client';
import { APPROVAL_ENTITIES, APPROVAL_ENTITY_LABEL, approvalEntityPath, approveSchema, rejectSchema, uuid, type ApprovalEntityType } from '@sima/shared';
import { prisma } from '../../lib/prisma';
import { ok, paginated } from '../../lib/respond';
import { notFound } from '../../lib/errors';
import { parseListQuery } from '../../lib/list';
import { currentUser, requirePermission, type AuthContext } from '../../plugins/auth';
import { decide, isEligible } from './service';

type Row = Prisma.ApprovalRequestGetPayload<{ include: { steps: { include: { role: true } } } }>;

async function present(rows: Row[], auth: AuthContext) {
  const users = await prisma.user.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.requestedById))] } }, select: { id: true, name: true } });
  const name = new Map(users.map((u) => [u.id, u.name]));
  return rows.map((r) => {
    const step = r.steps.find((s) => s.stepOrder === r.currentStep);
    const type = r.entityType as ApprovalEntityType;
    return {
      id: r.id, entityType: type, entityLabel: APPROVAL_ENTITY_LABEL[type], entityId: r.entityId, path: approvalEntityPath(type, r.entityId),
      documentNumber: r.documentNumber, title: r.title, status: r.status, requestedBy: name.get(r.requestedById) ?? '-', requestedById: r.requestedById,
      submittedAt: r.submittedAt, completedAt: r.completedAt, currentRole: step?.role.name ?? null,
      canDecide: r.status === 'PENDING' && !!step && step.status === 'PENDING' && r.requestedById !== auth.user.id && isEligible(auth, type, step.role.code),
    };
  });
}

export async function approvalRoutes(app: FastifyInstance) {
  const include = { steps: { include: { role: true } } } as const;

  // scope=pending (default): yang dapat saya putuskan sekarang. scope=all: semua permintaan.
  app.get('/approvals', { preHandler: requirePermission('approvals.view') }, async (req) => {
    const auth = currentUser(req);
    const q = parseListQuery(req.query, ['submittedAt', 'documentNumber'], 'submittedAt', 'desc');
    const f = req.query as Record<string, string | undefined>;
    const type = f.entityType && (APPROVAL_ENTITIES as readonly string[]).includes(f.entityType) ? (f.entityType as ApprovalEntityType) : undefined;
    const base: Prisma.ApprovalRequestWhereInput = { ...(type ? { entityType: type } : {}), ...(q.search ? { OR: [{ documentNumber: { contains: q.search, mode: 'insensitive' } }, { title: { contains: q.search, mode: 'insensitive' } }] } : {}) };
    if (f.scope === 'all') {
      const where = { ...base, ...(f.status && ['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED'].includes(f.status) ? { status: f.status as never } : {}) };
      const [rows, total] = await Promise.all([prisma.approvalRequest.findMany({ where, include, orderBy: q.orderBy, skip: q.skip, take: q.take }), prisma.approvalRequest.count({ where })]);
      return paginated(await present(rows, auth), total, q.page, q.limit);
    }
    // Daftar tunggu pribadi: dihitung di memori karena kewenangan bergantung pada role + permission.
    const pending = await prisma.approvalRequest.findMany({ where: { ...base, status: 'PENDING', requestedById: { not: auth.user.id } }, include, orderBy: { submittedAt: 'asc' } });
    const mine = (await present(pending, auth)).filter((r) => r.canDecide);
    return paginated(mine.slice(q.skip, q.skip + q.take), mine.length, q.page, q.limit);
  });

  app.get('/approvals/history', { preHandler: requirePermission('approvals.view') }, async (req) => {
    const auth = currentUser(req);
    const q = parseListQuery(req.query, ['completedAt', 'documentNumber'], 'completedAt', 'desc');
    const where: Prisma.ApprovalRequestWhereInput = { status: { not: 'PENDING' }, ...(q.search ? { OR: [{ documentNumber: { contains: q.search, mode: 'insensitive' } }, { title: { contains: q.search, mode: 'insensitive' } }] } : {}) };
    const [rows, total] = await Promise.all([prisma.approvalRequest.findMany({ where, include, orderBy: q.orderBy, skip: q.skip, take: q.take }), prisma.approvalRequest.count({ where })]);
    return paginated(await present(rows, auth), total, q.page, q.limit);
  });

  app.get('/approvals/:id', { preHandler: requirePermission('approvals.view') }, async (req) => {
    const id = uuid().parse((req.params as { id: string }).id);
    const r = await prisma.approvalRequest.findUnique({ where: { id }, include: { ...include, actions: { orderBy: { createdAt: 'asc' } } } });
    if (!r) throw notFound('Permintaan persetujuan tidak ditemukan');
    const [row] = await present([r], currentUser(req));
    const users = await prisma.user.findMany({ where: { id: { in: r.actions.map((a) => a.actorId) } }, select: { id: true, name: true } });
    const name = new Map(users.map((u) => [u.id, u.name]));
    return ok({ ...row, actions: r.actions.map((a) => ({ action: a.action, actor: name.get(a.actorId) ?? '-', note: a.note, createdAt: a.createdAt })) });
  });

  // Izin spesifik (<modul>.approve/.reject) dan pemisahan tugas diperiksa di decide().
  app.post('/approvals/:id/approve', { preHandler: requirePermission('approvals.view') }, async (req) => {
    const id = uuid().parse((req.params as { id: string }).id);
    const { note } = approveSchema.parse(req.body ?? {});
    await prisma.$transaction((tx) => decide(tx, req, { requestId: id, actor: currentUser(req), decision: 'APPROVE', note }));
    return ok(null, 'Persetujuan dicatat');
  });

  app.post('/approvals/:id/reject', { preHandler: requirePermission('approvals.view') }, async (req) => {
    const id = uuid().parse((req.params as { id: string }).id);
    const { note } = rejectSchema.parse(req.body ?? {});
    await prisma.$transaction((tx) => decide(tx, req, { requestId: id, actor: currentUser(req), decision: 'REJECT', note }));
    return ok(null, 'Penolakan dicatat');
  });
}
