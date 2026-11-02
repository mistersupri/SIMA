import type { FastifyInstance } from 'fastify';
import { organizationSchema } from '@sima/shared';
import { prisma } from '../../lib/prisma';
import { ok } from '../../lib/respond';
import { writeAudit } from '../../lib/audit';
import { requirePermission } from '../../plugins/auth';

export async function settingsRoutes(app: FastifyInstance) {
  // Publik dan hanya memuat nama instansi (untuk halaman login). Tanpa data lain.
  app.get('/app-info', async () => {
    const org = await prisma.organization.findFirst({ select: { name: true } });
    return ok({ organizationName: org?.name ?? 'SIMA' });
  });

  app.get('/settings/organization', { preHandler: requirePermission('settings.manage') }, async () => {
    const o = await prisma.organization.findFirstOrThrow();
    return ok({ code: o.code, name: o.name, address: o.address, phone: o.phone, email: o.email });
  });

  app.patch('/settings/organization', { preHandler: requirePermission('settings.manage') }, async (req) => {
    const input = organizationSchema.parse(req.body);
    const before = await prisma.organization.findFirstOrThrow();
    const after = await prisma.$transaction(async (tx) => {
      const o = await tx.organization.update({ where: { id: before.id }, data: input });
      await writeAudit(tx, req, { action: 'UPDATE', entityType: 'Organization', entityId: o.id, before: { name: before.name, address: before.address, phone: before.phone, email: before.email }, after: input });
      return o;
    });
    return ok({ code: after.code, name: after.name, address: after.address, phone: after.phone, email: after.email }, 'Identitas instansi disimpan');
  });
}
