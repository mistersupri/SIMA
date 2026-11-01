import type { FastifyInstance } from 'fastify';
import { ROLE_CODES, createRoleSchema, rolePermissionsSchema, uuid } from '@sima/shared';
import { prisma } from '../../lib/prisma';
import { ok } from '../../lib/respond';
import { conflict, forbidden, notFound, unprocessable } from '../../lib/errors';
import { writeAudit } from '../../lib/audit';
import { requirePermission } from '../../plugins/auth';

const roleSelect = {
  id: true, code: true, name: true, description: true, isSystem: true,
  permissions: { select: { permission: { select: { code: true } } } },
  _count: { select: { users: true } },
} as const;

export async function roleRoutes(app: FastifyInstance) {
  app.get('/roles', { preHandler: requirePermission('roles.view') }, async () => {
    const roles = await prisma.role.findMany({ select: roleSelect, orderBy: [{ isSystem: 'desc' }, { name: 'asc' }] });
    return ok(roles.map((r) => ({
      id: r.id, code: r.code, name: r.name, description: r.description, isSystem: r.isSystem,
      userCount: r._count.users, permissions: r.permissions.map((p) => p.permission.code).sort(),
    })));
  });

  // Daftar role ringkas untuk dropdown (form pengguna), cukup users.view.
  app.get('/roles/options', { preHandler: requirePermission('users.view') }, async () => {
    const roles = await prisma.role.findMany({ select: { id: true, code: true, name: true }, orderBy: { name: 'asc' } });
    return ok(roles);
  });

  app.get('/permissions', { preHandler: requirePermission('roles.view') }, async () => {
    const rows = await prisma.permission.findMany({ orderBy: [{ module: 'asc' }, { code: 'asc' }] });
    return ok(rows.map((p) => ({ id: p.id, code: p.code, module: p.module, description: p.description })));
  });

  app.post('/roles', { preHandler: requirePermission('roles.manage') }, async (req, reply) => {
    const input = createRoleSchema.parse(req.body);
    if (await prisma.role.findUnique({ where: { code: input.code } })) {
      throw conflict('Kode role sudah dipakai', [{ field: 'code', message: 'Kode role sudah dipakai' }]);
    }
    const role = await prisma.$transaction(async (tx) => {
      const r = await tx.role.create({ data: { ...input, isSystem: false } });
      await writeAudit(tx, req, { action: 'CREATE', entityType: 'Role', entityId: r.id, after: r });
      return r;
    });
    return reply.code(201).send(ok(role, 'Role berhasil dibuat'));
  });

  app.put('/roles/:id/permissions', { preHandler: requirePermission('roles.manage') }, async (req) => {
    const id = uuid().parse((req.params as { id: string }).id);
    const { permissions: codes } = rolePermissionsSchema.parse(req.body);
    const role = await prisma.role.findUnique({ where: { id }, include: { permissions: { include: { permission: true } } } });
    if (!role) throw notFound('Role tidak ditemukan');
    if (role.code === ROLE_CODES.SUPER_ADMIN) throw forbidden('Permission Super Admin tidak dapat diubah');

    const unique = [...new Set(codes)];
    const found = await prisma.permission.findMany({ where: { code: { in: unique } } });
    if (found.length !== unique.length) {
      const known = new Set(found.map((p) => p.code));
      throw unprocessable('Permission tidak dikenal', unique.filter((c) => !known.has(c)).map((c) => ({ field: 'permissions', message: `Permission "${c}" tidak ada` })));
    }
    await prisma.$transaction(async (tx) => {
      await tx.rolePermission.deleteMany({ where: { roleId: id } });
      await tx.rolePermission.createMany({ data: found.map((p) => ({ roleId: id, permissionId: p.id })) });
      await writeAudit(tx, req, {
        action: 'PERMISSION_CHANGE', entityType: 'Role', entityId: id,
        before: { permissions: role.permissions.map((p) => p.permission.code).sort() },
        after: { permissions: unique.sort() },
      });
    });
    return ok({ permissions: unique }, 'Permission role diperbarui');
  });

  app.delete('/roles/:id', { preHandler: requirePermission('roles.manage') }, async (req) => {
    const id = uuid().parse((req.params as { id: string }).id);
    const role = await prisma.role.findUnique({ where: { id }, include: { _count: { select: { users: true } } } });
    if (!role) throw notFound('Role tidak ditemukan');
    if (role.isSystem) throw forbidden('Role bawaan sistem tidak dapat dihapus');
    if (role._count.users > 0) throw conflict('Role masih dipakai pengguna');
    await prisma.$transaction(async (tx) => {
      await tx.role.delete({ where: { id } });
      await writeAudit(tx, req, { action: 'DELETE', entityType: 'Role', entityId: id, before: role });
    });
    return ok(null, 'Role dihapus');
  });
}
