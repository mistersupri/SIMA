import type { Prisma } from '@prisma/client';

type Tx = Prisma.TransactionClient;

export interface NotificationInput {
  type: string;
  title: string;
  body?: string | null;
  entityType?: string | null;
  entityId?: string | null;
  /** Mencegah notifikasi ganda untuk peristiwa yang sama (misalnya pengingat harian). */
  dedupeKey?: string | null;
}

export async function notify(tx: Tx, userIds: string[], n: NotificationInput) {
  const ids = [...new Set(userIds)];
  if (!ids.length) return;
  await tx.notification.createMany({
    data: ids.map((userId) => ({ userId, type: n.type, title: n.title, body: n.body ?? null, entityType: n.entityType ?? null, entityId: n.entityId ?? null, dedupeKey: n.dedupeKey ?? null })),
    skipDuplicates: true,
  });
}

/** Pengguna aktif yang memiliki permission tertentu (opsional: dan salah satu role tertentu). */
export async function usersWithPermission(tx: Tx, permission: string, opts: { roleCodes?: string[]; excludeUserId?: string } = {}) {
  const users = await tx.user.findMany({
    where: {
      status: 'ACTIVE',
      ...(opts.excludeUserId ? { id: { not: opts.excludeUserId } } : {}),
      AND: [
        { roles: { some: { role: { permissions: { some: { permission: { code: permission } } } } } } },
        ...(opts.roleCodes ? [{ roles: { some: { role: { code: { in: opts.roleCodes } } } } }] : []),
      ],
    },
    select: { id: true },
  });
  return users.map((u) => u.id);
}
