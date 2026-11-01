import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { uuid } from '@sima/shared';
import { prisma } from '../../lib/prisma';
import { ok, paginated } from '../../lib/respond';
import { notFound, unprocessable } from '../../lib/errors';
import { writeAudit } from '../../lib/audit';
import { parseBool, parseListQuery } from '../../lib/list';
import { requirePermission } from '../../plugins/auth';
import { MASTER_REGISTRY, type MasterConfig } from './registry';

// Satu-satunya titik dengan delegate Prisma dinamis; seluruh input sudah divalidasi Zod.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Delegate = any;
const delegateOf = (cfg: MasterConfig): Delegate => (prisma as unknown as Record<string, Delegate>)[cfg.model];

/** Tolak parent yang membuat siklus (diri sendiri atau turunannya). */
async function assertNoCycle(cfg: MasterConfig, id: string, parentId: string | null) {
  if (!parentId) return;
  if (parentId === id) throw unprocessable('Induk tidak boleh diri sendiri', [{ field: 'parentId', message: 'Induk tidak boleh diri sendiri' }]);
  const model = delegateOf(cfg);
  let cursor: string | null = parentId;
  for (let depth = 0; cursor && depth < 50; depth++) {
    if (cursor === id) throw unprocessable('Induk membentuk siklus', [{ field: 'parentId', message: 'Induk tidak boleh berupa turunan sendiri' }]);
    const row: { parentId: string | null } | null = await model.findUnique({ where: { id: cursor }, select: { parentId: true } });
    cursor = row?.parentId ?? null;
  }
}

export async function masterRoutes(app: FastifyInstance) {
  for (const cfg of MASTER_REGISTRY) {
    const base = `/${cfg.path}`;
    const model = delegateOf(cfg);
    const entityId = (req: { params: unknown }) => uuid().parse((req.params as { id: string }).id);

    app.get(base, { preHandler: requirePermission('master.view') }, async (req) => {
      const q = parseListQuery(req.query, cfg.sortable, cfg.defaultSort);
      const { isActive } = req.query as { isActive?: string };
      const active = parseBool(isActive);
      const where = {
        ...(q.search ? { OR: cfg.searchFields.map((f) => ({ [f]: { contains: q.search, mode: 'insensitive' } })) } : {}),
        ...(active !== undefined ? { isActive: active } : {}),
      };
      const [rows, total] = await Promise.all([
        model.findMany({ where, include: cfg.include, orderBy: q.orderBy, skip: q.skip, take: q.take }),
        model.count({ where }),
      ]);
      return paginated(rows, total, q.page, q.limit);
    });

    app.get(`${base}/:id`, { preHandler: requirePermission('master.view') }, async (req) => {
      const row = await model.findUnique({ where: { id: entityId(req) }, include: cfg.include });
      if (!row) throw notFound(`${cfg.label} tidak ditemukan`);
      return ok(row);
    });

    app.post(base, { preHandler: requirePermission('master.manage') }, async (req, reply) => {
      const data = cfg.schema.parse(req.body) as Record<string, unknown>;
      const created = await prisma.$transaction(async (tx) => {
        const row = await (tx as unknown as Record<string, Delegate>)[cfg.model].create({ data, include: cfg.include });
        await writeAudit(tx, req, { action: 'CREATE', entityType: cfg.entity, entityId: row.id, after: row });
        return row;
      });
      return reply.code(201).send(ok(created, `${cfg.label} berhasil ditambahkan`));
    });

    app.patch(`${base}/:id`, { preHandler: requirePermission('master.manage') }, async (req) => {
      const id = entityId(req);
      const schema = (cfg.schema as z.ZodObject).partial();
      const data = schema.parse(req.body) as Record<string, unknown>;
      const before = await model.findUnique({ where: { id } });
      if (!before) throw notFound(`${cfg.label} tidak ditemukan`);
      if (cfg.parentKey && 'parentId' in data) await assertNoCycle(cfg, id, data.parentId as string | null);
      const updated = await prisma.$transaction(async (tx) => {
        const row = await (tx as unknown as Record<string, Delegate>)[cfg.model].update({ where: { id }, data, include: cfg.include });
        await writeAudit(tx, req, { action: 'UPDATE', entityType: cfg.entity, entityId: id, before, after: row });
        return row;
      });
      return ok(updated, `${cfg.label} berhasil diperbarui`);
    });

    // Master data yang sudah dipakai transaksi tidak dihapus permanen: DELETE = nonaktifkan.
    app.delete(`${base}/:id`, { preHandler: requirePermission('master.manage') }, async (req) => {
      const id = entityId(req);
      const before = await model.findUnique({ where: { id } });
      if (!before) throw notFound(`${cfg.label} tidak ditemukan`);
      const updated = await prisma.$transaction(async (tx) => {
        const row = await (tx as unknown as Record<string, Delegate>)[cfg.model].update({ where: { id }, data: { isActive: false } });
        await writeAudit(tx, req, { action: 'ARCHIVE', entityType: cfg.entity, entityId: id, before: { isActive: before.isActive }, after: { isActive: false } });
        return row;
      });
      return ok(updated, `${cfg.label} dinonaktifkan`);
    });
  }
}
