import type { FastifyInstance } from 'fastify';
import type { Prisma } from '@prisma/client';
import { paginated, ok } from '../../lib/respond';
import { prisma } from '../../lib/prisma';
import { parseListQuery } from '../../lib/list';
import { requirePermission } from '../../plugins/auth';
import { describeAudit, ENTITY_LABEL } from '../reports/dashboard';

/** Audit log hanya dapat dibaca. Tidak ada endpoint ubah/hapus, dan trigger database menolak UPDATE/DELETE. */
export async function auditRoutes(app: FastifyInstance) {
  app.get('/audit-logs', { preHandler: requirePermission('audit.view') }, async (req) => {
    const q = parseListQuery(req.query, ['createdAt', 'action', 'entityType'], 'createdAt', 'desc');
    const f = req.query as Record<string, string | undefined>;
    const day = (s?: string) => (s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? new Date(s) : undefined);
    const to = day(f.to);
    const where: Prisma.AuditLogWhereInput = {
      ...(f.entityType ? { entityType: f.entityType } : {}), ...(f.action ? { action: f.action } : {}), ...(f.userId && /^[0-9a-f-]{36}$/.test(f.userId) ? { userId: f.userId } : {}),
      ...(f.entityId ? { entityId: f.entityId } : {}),
      ...(day(f.from) || to ? { createdAt: { gte: day(f.from), lt: to ? new Date(to.getTime() + 86400000) : undefined } } : {}),
      ...(q.search ? { OR: [{ action: { contains: q.search, mode: 'insensitive' } }, { entityType: { contains: q.search, mode: 'insensitive' } }, { entityId: { contains: q.search, mode: 'insensitive' } }] } : {}),
    };
    const [rows, total] = await Promise.all([prisma.auditLog.findMany({ where, orderBy: q.orderBy, skip: q.skip, take: q.take }), prisma.auditLog.count({ where })]);
    const users = await prisma.user.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.userId).filter(Boolean) as string[])] } }, select: { id: true, name: true } });
    const name = new Map(users.map((u) => [u.id, u.name]));
    return paginated(rows.map((r) => ({ id: r.id, createdAt: r.createdAt, user: r.userId ? name.get(r.userId) ?? '-' : 'Sistem', action: r.action, entityType: r.entityType, entityId: r.entityId, summary: describeAudit(r.action, r.entityType, r.after), before: r.before, after: r.after, ipAddress: r.ipAddress })), total, q.page, q.limit);
  });

  app.get('/audit-logs/options', { preHandler: requirePermission('audit.view') }, async () => {
    const [actions, entities] = await Promise.all([prisma.auditLog.findMany({ distinct: ['action'], select: { action: true }, orderBy: { action: 'asc' } }), prisma.auditLog.findMany({ distinct: ['entityType'], select: { entityType: true }, orderBy: { entityType: 'asc' } })]);
    return ok({ actions: actions.map((a) => a.action), entities: entities.map((e) => ({ key: e.entityType, label: ENTITY_LABEL[e.entityType] ?? e.entityType })) });
  });
}
