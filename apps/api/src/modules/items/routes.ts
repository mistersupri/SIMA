import type { FastifyInstance } from 'fastify';
import { Prisma } from '@prisma/client';
import { createItemSchema, updateItemSchema, uuid } from '@sima/shared';
import { prisma } from '../../lib/prisma';
import { ok, paginated } from '../../lib/respond';
import { notFound, unprocessable } from '../../lib/errors';
import { writeAudit } from '../../lib/audit';
import { nextSequence, pad } from '../../lib/sequence';
import { parseBool, parseListQuery } from '../../lib/list';
import { currentUser, requirePermission } from '../../plugins/auth';

const include = {
  category: { select: { id: true, name: true, codePrefix: true } },
  brand: { select: { id: true, name: true } },
  unitOfMeasure: { select: { id: true, code: true, name: true } },
  _count: { select: { assets: true } },
} satisfies Prisma.ItemInclude;

async function assertRefs(input: { categoryId: string; brandId: string | null; unitOfMeasureId: string }) {
  const [cat, brand, uom] = await Promise.all([
    prisma.category.findUnique({ where: { id: input.categoryId } }),
    input.brandId ? prisma.brand.findUnique({ where: { id: input.brandId } }) : null,
    prisma.unitOfMeasure.findUnique({ where: { id: input.unitOfMeasureId } }),
  ]);
  const errors = [];
  if (!cat || !cat.isActive) errors.push({ field: 'categoryId', message: 'Kategori tidak valid atau nonaktif' });
  if (input.brandId && (!brand || !brand.isActive)) errors.push({ field: 'brandId', message: 'Merek tidak valid atau nonaktif' });
  if (!uom || !uom.isActive) errors.push({ field: 'unitOfMeasureId', message: 'Satuan tidak valid atau nonaktif' });
  if (errors.length) throw unprocessable('Referensi tidak valid', errors);
  return cat!;
}

export async function itemRoutes(app: FastifyInstance) {
  app.get('/items', { preHandler: requirePermission('items.view') }, async (req) => {
    const q = parseListQuery(req.query, ['code', 'name', 'createdAt', 'minStock'], 'name');
    const { type, categoryId, isActive } = req.query as Record<string, string | undefined>;
    const active = parseBool(isActive);
    const where: Prisma.ItemWhereInput = {
      ...(q.search ? { OR: [
        { name: { contains: q.search, mode: 'insensitive' } }, { code: { contains: q.search, mode: 'insensitive' } },
        { model: { contains: q.search, mode: 'insensitive' } },
      ] } : {}),
      ...(type === 'ASSET' || type === 'SUPPLY' ? { type } : {}),
      ...(categoryId ? { categoryId: uuid('Kategori').parse(categoryId) } : {}),
      ...(active !== undefined ? { isActive: active } : {}),
    };
    const [rows, total] = await Promise.all([
      prisma.item.findMany({ where, include, orderBy: q.orderBy, skip: q.skip, take: q.take }),
      prisma.item.count({ where }),
    ]);
    const sums = await prisma.stockBalance.groupBy({ by: ['itemId'], where: { itemId: { in: rows.map((r) => r.id) } }, _sum: { quantity: true } });
    const stock = new Map(sums.map((s) => [s.itemId, s._sum.quantity?.toString() ?? '0']));
    return paginated(rows.map(({ _count, ...r }) => ({ ...r, assetCount: _count.assets, stockTotal: r.type === 'SUPPLY' ? (stock.get(r.id) ?? '0') : null })), total, q.page, q.limit);
  });

  app.get('/items/:id', { preHandler: requirePermission('items.view') }, async (req) => {
    const id = uuid().parse((req.params as { id: string }).id);
    const item = await prisma.item.findUnique({ where: { id }, include });
    if (!item) throw notFound('Barang tidak ditemukan');
    const { _count, ...rest } = item;
    return ok({ ...rest, assetCount: _count.assets });
  });

  app.post('/items', { preHandler: requirePermission('items.create') }, async (req, reply) => {
    const input = createItemSchema.parse(req.body);
    const cat = await assertRefs(input);
    const created = await prisma.$transaction(async (tx) => {
      // Aset: BRG-ELK-000001, persediaan: PRS-ATK-000001 (nomor urut per jenis, global).
      const seq = await nextSequence(tx, `ITEM:${input.type}`);
      const code = `${input.type === 'ASSET' ? 'BRG' : 'PRS'}-${cat.codePrefix}-${pad(seq)}`;
      const item = await tx.item.create({ data: { ...input, code, createdById: currentUser(req).user.id }, include });
      await writeAudit(tx, req, { action: 'CREATE', entityType: 'Item', entityId: item.id, after: item });
      return item;
    });
    return reply.code(201).send(ok(created, 'Master barang ditambahkan'));
  });

  app.patch('/items/:id', { preHandler: requirePermission('items.update') }, async (req) => {
    const id = uuid().parse((req.params as { id: string }).id);
    const input = updateItemSchema.parse(req.body);
    const before = await prisma.item.findUnique({ where: { id } });
    if (!before) throw notFound('Barang tidak ditemukan');
    await assertRefs(input);
    const after = await prisma.$transaction(async (tx) => {
      const item = await tx.item.update({ where: { id }, data: input, include });
      await writeAudit(tx, req, { action: 'UPDATE', entityType: 'Item', entityId: id, before, after: item });
      return item;
    });
    return ok(after, 'Master barang diperbarui');
  });

  for (const [path, archived] of [['archive', true], ['unarchive', false]] as const) {
    app.post(`/items/:id/${path}`, { preHandler: requirePermission('items.archive') }, async (req) => {
      const id = uuid().parse((req.params as { id: string }).id);
      const before = await prisma.item.findUnique({ where: { id } });
      if (!before) throw notFound('Barang tidak ditemukan');
      const after = await prisma.$transaction(async (tx) => {
        const item = await tx.item.update({ where: { id }, data: { isActive: !archived, archivedAt: archived ? new Date() : null }, include });
        await writeAudit(tx, req, { action: archived ? 'ARCHIVE' : 'UNARCHIVE', entityType: 'Item', entityId: id, before: { isActive: before.isActive }, after: { isActive: item.isActive } });
        return item;
      });
      return ok(after, archived ? 'Barang diarsipkan' : 'Barang diaktifkan kembali');
    });
  }
}
