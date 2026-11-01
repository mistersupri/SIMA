import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Prisma } from '@prisma/client';
import {
  ROLE_CODES, adminResetPasswordSchema, createUserSchema, updateUserSchema, userRolesSchema,
  userStatusSchema, userUnitAccessSchema, uuid, type UserListItem,
} from '@sima/shared';
import { prisma } from '../../lib/prisma';
import { ok, paginated } from '../../lib/respond';
import { conflict, forbidden, notFound, unprocessable } from '../../lib/errors';
import { hashPassword } from '../../lib/password';
import { writeAudit } from '../../lib/audit';
import { parseListQuery } from '../../lib/list';
import { currentUser, requirePermission, revokeUserSessions } from '../../plugins/auth';

const userInclude = {
  unit: { select: { id: true, name: true } },
  roles: { include: { role: { select: { id: true, code: true, name: true } } } },
} satisfies Prisma.UserInclude;

type UserRow = Prisma.UserGetPayload<{ include: typeof userInclude }>;

const toListItem = (u: UserRow): UserListItem => ({
  id: u.id,
  email: u.email,
  name: u.name,
  status: u.status,
  unitId: u.unitId,
  unit: u.unit,
  roles: u.roles.map((r) => r.role),
  lastLoginAt: u.lastLoginAt?.toISOString() ?? null,
  createdAt: u.createdAt.toISOString(),
});

const snapshot = (u: UserRow) => ({ id: u.id, email: u.email, name: u.name, status: u.status, unitId: u.unitId, roles: u.roles.map((r) => r.role.code) });

async function activeSuperAdminCountExcluding(tx: Prisma.TransactionClient, userId: string) {
  return tx.user.count({
    where: { id: { not: userId }, status: 'ACTIVE', roles: { some: { role: { code: ROLE_CODES.SUPER_ADMIN } } } },
  });
}

/** Hanya Super Admin yang boleh memberi atau mencabut role Super Admin. */
async function assertCanTouchSuperAdminRole(req: FastifyRequest, roleIds: string[], currentRoleIds: string[]) {
  const sa = await prisma.role.findUnique({ where: { code: ROLE_CODES.SUPER_ADMIN } });
  if (!sa) return;
  const touched = roleIds.includes(sa.id) !== currentRoleIds.includes(sa.id);
  if (touched && !currentUser(req).roleCodes.has(ROLE_CODES.SUPER_ADMIN)) {
    throw forbidden('Hanya Super Admin yang dapat mengubah role Super Admin');
  }
}

async function assertRolesExist(roleIds: string[]) {
  const count = await prisma.role.count({ where: { id: { in: roleIds } } });
  if (count !== new Set(roleIds).size) throw unprocessable('Role tidak ditemukan', [{ field: 'roleIds', message: 'Ada role yang tidak valid' }]);
}

export async function userRoutes(app: FastifyInstance) {
  app.get('/users', { preHandler: requirePermission('users.view') }, async (req) => {
    const q = parseListQuery(req.query, ['name', 'email', 'status', 'createdAt', 'lastLoginAt'], 'name');
    const { status, roleId } = req.query as { status?: string; roleId?: string };
    const where: Prisma.UserWhereInput = {
      ...(q.search ? { OR: [{ name: { contains: q.search, mode: 'insensitive' } }, { email: { contains: q.search, mode: 'insensitive' } }] } : {}),
      ...(status === 'ACTIVE' || status === 'INACTIVE' ? { status } : {}),
      ...(roleId ? { roles: { some: { roleId: uuid('Role').parse(roleId) } } } : {}),
    };
    const [rows, total] = await Promise.all([
      prisma.user.findMany({ where, include: userInclude, orderBy: q.orderBy, skip: q.skip, take: q.take }),
      prisma.user.count({ where }),
    ]);
    return paginated(rows.map(toListItem), total, q.page, q.limit);
  });

  app.get('/users/:id', { preHandler: requirePermission('users.view') }, async (req) => {
    const { id } = req.params as { id: string };
    const user = await prisma.user.findUnique({ where: { id: uuid().parse(id) }, include: { ...userInclude, unitAccess: true } });
    if (!user) throw notFound('Pengguna tidak ditemukan');
    return ok({ ...toListItem(user), unitAccessIds: user.unitAccess.map((a) => a.unitId) });
  });

  app.post('/users', { preHandler: requirePermission('users.manage') }, async (req, reply) => {
    const input = createUserSchema.parse(req.body);
    await assertRolesExist(input.roleIds);
    await assertCanTouchSuperAdminRole(req, input.roleIds, []);
    if (await prisma.user.findUnique({ where: { email: input.email } })) {
      throw conflict('Email sudah terdaftar', [{ field: 'email', message: 'Email sudah terdaftar' }]);
    }
    const org = await prisma.organization.findFirstOrThrow();
    const passwordHash = await hashPassword(input.password);
    const created = await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          organizationId: org.id, email: input.email, name: input.name, unitId: input.unitId, passwordHash,
          mustChangePassword: true,
          roles: { create: [...new Set(input.roleIds)].map((roleId) => ({ roleId })) },
        },
        include: userInclude,
      });
      await writeAudit(tx, req, { action: 'CREATE', entityType: 'User', entityId: user.id, after: snapshot(user) });
      return user;
    });
    return reply.code(201).send(ok(toListItem(created), 'Pengguna berhasil dibuat'));
  });

  app.patch('/users/:id', { preHandler: requirePermission('users.manage') }, async (req) => {
    const id = uuid().parse((req.params as { id: string }).id);
    const input = updateUserSchema.parse(req.body);
    const before = await prisma.user.findUnique({ where: { id }, include: userInclude });
    if (!before) throw notFound('Pengguna tidak ditemukan');
    const dup = await prisma.user.findFirst({ where: { email: input.email, id: { not: id } } });
    if (dup) throw conflict('Email sudah terdaftar', [{ field: 'email', message: 'Email sudah terdaftar' }]);
    const after = await prisma.$transaction(async (tx) => {
      const u = await tx.user.update({ where: { id }, data: { name: input.name, email: input.email, unitId: input.unitId }, include: userInclude });
      await writeAudit(tx, req, { action: 'UPDATE', entityType: 'User', entityId: id, before: snapshot(before), after: snapshot(u) });
      return u;
    });
    return ok(toListItem(after), 'Pengguna berhasil diperbarui');
  });

  app.patch('/users/:id/status', { preHandler: requirePermission('users.manage') }, async (req) => {
    const id = uuid().parse((req.params as { id: string }).id);
    const { status } = userStatusSchema.parse(req.body);
    const auth = currentUser(req);
    const before = await prisma.user.findUnique({ where: { id }, include: userInclude });
    if (!before) throw notFound('Pengguna tidak ditemukan');
    if (status === 'INACTIVE' && id === auth.user.id) throw unprocessable('Anda tidak dapat menonaktifkan akun sendiri');

    const after = await prisma.$transaction(async (tx) => {
      if (status === 'INACTIVE' && before.roles.some((r) => r.role.code === ROLE_CODES.SUPER_ADMIN)) {
        if ((await activeSuperAdminCountExcluding(tx, id)) < 1) throw unprocessable('Tidak dapat menonaktifkan Super Admin terakhir');
      }
      const u = await tx.user.update({ where: { id }, data: { status }, include: userInclude });
      await writeAudit(tx, req, { action: 'STATUS_CHANGE', entityType: 'User', entityId: id, before: { status: before.status }, after: { status } });
      return u;
    });
    if (status === 'INACTIVE') await revokeUserSessions(id);
    return ok(toListItem(after), status === 'ACTIVE' ? 'Pengguna diaktifkan' : 'Pengguna dinonaktifkan');
  });

  app.put('/users/:id/roles', { preHandler: requirePermission('users.manage') }, async (req) => {
    const id = uuid().parse((req.params as { id: string }).id);
    const { roleIds: raw } = userRolesSchema.parse(req.body);
    const roleIds = [...new Set(raw)];
    await assertRolesExist(roleIds);
    const before = await prisma.user.findUnique({ where: { id }, include: userInclude });
    if (!before) throw notFound('Pengguna tidak ditemukan');
    await assertCanTouchSuperAdminRole(req, roleIds, before.roles.map((r) => r.roleId));

    const after = await prisma.$transaction(async (tx) => {
      const sa = await tx.role.findUnique({ where: { code: ROLE_CODES.SUPER_ADMIN } });
      const losesSa = sa && before.roles.some((r) => r.roleId === sa.id) && !roleIds.includes(sa.id);
      if (losesSa && before.status === 'ACTIVE' && (await activeSuperAdminCountExcluding(tx, id)) < 1) {
        throw unprocessable('Tidak dapat mencabut role Super Admin terakhir');
      }
      await tx.userRole.deleteMany({ where: { userId: id } });
      await tx.userRole.createMany({ data: roleIds.map((roleId) => ({ userId: id, roleId })) });
      const u = await tx.user.findUniqueOrThrow({ where: { id }, include: userInclude });
      await writeAudit(tx, req, { action: 'ROLE_CHANGE', entityType: 'User', entityId: id, before: { roles: before.roles.map((r) => r.role.code) }, after: { roles: u.roles.map((r) => r.role.code) } });
      return u;
    });
    return ok(toListItem(after), 'Role pengguna diperbarui');
  });

  app.put('/users/:id/unit-access', { preHandler: requirePermission('users.manage') }, async (req) => {
    const id = uuid().parse((req.params as { id: string }).id);
    const { unitIds: raw } = userUnitAccessSchema.parse(req.body);
    const unitIds = [...new Set(raw)];
    if (!(await prisma.user.findUnique({ where: { id } }))) throw notFound('Pengguna tidak ditemukan');
    if ((await prisma.organizationalUnit.count({ where: { id: { in: unitIds } } })) !== unitIds.length) throw unprocessable('Ada unit kerja yang tidak valid');
    const before = await prisma.userUnitAccess.findMany({ where: { userId: id } });
    await prisma.$transaction(async (tx) => {
      await tx.userUnitAccess.deleteMany({ where: { userId: id } });
      await tx.userUnitAccess.createMany({ data: unitIds.map((unitId) => ({ userId: id, unitId })) });
      await writeAudit(tx, req, { action: 'UPDATE', entityType: 'UserUnitAccess', entityId: id, before: { unitIds: before.map((b) => b.unitId) }, after: { unitIds } });
    });
    return ok({ unitIds }, 'Akses unit diperbarui');
  });

  app.post('/users/:id/reset-password', { preHandler: requirePermission('users.manage') }, async (req) => {
    const id = uuid().parse((req.params as { id: string }).id);
    const { newPassword } = adminResetPasswordSchema.parse(req.body);
    if (!(await prisma.user.findUnique({ where: { id } }))) throw notFound('Pengguna tidak ditemukan');
    await prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id }, data: { passwordHash: await hashPassword(newPassword), mustChangePassword: true, failedLoginCount: 0, lockedUntil: null } });
      await writeAudit(tx, req, { action: 'PASSWORD_RESET', entityType: 'User', entityId: id });
    });
    await revokeUserSessions(id);
    return ok(null, 'Password diatur ulang. Pengguna wajib menggantinya saat login.');
  });
}
