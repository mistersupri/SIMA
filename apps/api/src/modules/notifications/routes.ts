import type { FastifyInstance } from 'fastify';
import type { Prisma } from '@prisma/client';
import { uuid } from '@sima/shared';
import { prisma } from '../../lib/prisma';
import { ok, paginated } from '../../lib/respond';
import { notFound } from '../../lib/errors';
import { parseBool, parseListQuery } from '../../lib/list';
import { authenticate, currentUser } from '../../plugins/auth';

/** Notifikasi bersifat pribadi: setiap pengguna hanya dapat melihat dan menandai miliknya sendiri. */
export async function notificationRoutes(app: FastifyInstance) {
  app.get('/notifications', { preHandler: authenticate }, async (req) => {
    const q = parseListQuery(req.query, ['createdAt'], 'createdAt', 'desc');
    const unread = parseBool((req.query as { unread?: string }).unread);
    const where: Prisma.NotificationWhereInput = { userId: currentUser(req).user.id, ...(unread ? { readAt: null } : {}) };
    const [rows, total] = await Promise.all([prisma.notification.findMany({ where, orderBy: q.orderBy, skip: q.skip, take: q.take }), prisma.notification.count({ where })]);
    return paginated(rows, total, q.page, q.limit);
  });

  app.get('/notifications/unread-count', { preHandler: authenticate }, async (req) =>
    ok({ count: await prisma.notification.count({ where: { userId: currentUser(req).user.id, readAt: null } }) }));

  app.post('/notifications/read-all', { preHandler: authenticate }, async (req) => {
    const r = await prisma.notification.updateMany({ where: { userId: currentUser(req).user.id, readAt: null }, data: { readAt: new Date() } });
    return ok({ updated: r.count }, 'Semua notifikasi ditandai sudah dibaca');
  });

  app.post('/notifications/:id/read', { preHandler: authenticate }, async (req) => {
    const id = uuid().parse((req.params as { id: string }).id);
    const r = await prisma.notification.updateMany({ where: { id, userId: currentUser(req).user.id, readAt: null }, data: { readAt: new Date() } });
    if (!r.count && !(await prisma.notification.findFirst({ where: { id, userId: currentUser(req).user.id } }))) throw notFound('Notifikasi tidak ditemukan');
    return ok(null, 'Ditandai sudah dibaca');
  });
}
