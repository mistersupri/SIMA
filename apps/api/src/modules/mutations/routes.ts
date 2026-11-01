import type { FastifyInstance } from 'fastify';
import type { Prisma } from '@prisma/client';
import { mutationSchema, uuid, type MutationInput } from '@sima/shared';
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

type Tx = Prisma.TransactionClient;
const EDITABLE = ['DRAFT', 'REJECTED'] as const;
const OPEN = ['DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'IN_TRANSFER'] as const;

registerApprovalHandler('MUTATION', {
  creatorId: async (tx, id) => (await tx.assetMutation.findUnique({ where: { id }, select: { createdById: true } }))?.createdById ?? null,
  // Persetujuan TIDAK memindahkan aset. Lokasi baru berlaku setelah pemindahan dikonfirmasi selesai.
  onApproved: async (tx, { entityId }) => { await tx.assetMutation.update({ where: { id: entityId }, data: { status: 'APPROVED', approvedAt: new Date() } }); },
  onRejected: async (tx, { entityId }) => { await tx.assetMutation.update({ where: { id: entityId }, data: { status: 'REJECTED' } }); },
});

async function buildDetails(tx: Tx | typeof prisma, input: MutationInput, excludeMutationId?: string) {
  const assets = await tx.asset.findMany({ where: { id: { in: input.lines.map((l) => l.assetId) } } });
  const byId = new Map(assets.map((a) => [a.id, a]));
  const [units, locations, persons] = await Promise.all([
    tx.organizationalUnit.findMany({ where: { id: { in: input.lines.map((l) => l.toUnitId) } } }),
    tx.location.findMany({ where: { id: { in: input.lines.map((l) => l.toLocationId) } } }),
    tx.person.findMany({ where: { id: { in: input.lines.flatMap((l) => (l.toPersonId ? [l.toPersonId] : [])) } } }),
  ]);
  const busy = await tx.assetMutationDetail.findMany({
    where: { assetId: { in: assets.map((a) => a.id) }, mutation: { status: { in: [...OPEN] }, ...(excludeMutationId ? { id: { not: excludeMutationId } } : {}) } },
    include: { mutation: { select: { number: true } } },
  });
  const errors: { field: string; message: string }[] = [];
  const rows = input.lines.map((l, i) => {
    const a = byId.get(l.assetId);
    const f = (k: string) => `lines.${i}.${k}`;
    if (!a) { errors.push({ field: f('assetId'), message: 'Aset tidak ditemukan' }); return null; }
    if (a.status !== 'AVAILABLE') errors.push({ field: f('assetId'), message: `${a.code} berstatus ${a.status} dan tidak dapat dimutasi` });
    const b = busy.find((x) => x.assetId === a.id);
    if (b) errors.push({ field: f('assetId'), message: `${a.code} sudah ada di mutasi ${b.mutation.number}` });
    if (!units.find((u) => u.id === l.toUnitId)?.isActive) errors.push({ field: f('toUnitId'), message: 'Unit tujuan tidak valid atau nonaktif' });
    if (!locations.find((x) => x.id === l.toLocationId)?.isActive) errors.push({ field: f('toLocationId'), message: 'Lokasi tujuan tidak valid atau nonaktif' });
    if (l.toPersonId && !persons.find((p) => p.id === l.toPersonId)?.isActive) errors.push({ field: f('toPersonId'), message: 'Penanggung jawab tidak valid atau nonaktif' });
    if (a.unitId === l.toUnitId && a.locationId === l.toLocationId && a.personId === (l.toPersonId ?? null)) errors.push({ field: f('toLocationId'), message: `${a.code} sudah berada di tujuan ini` });
    return { assetId: a.id, fromUnitId: a.unitId, toUnitId: l.toUnitId, fromLocationId: a.locationId, toLocationId: l.toLocationId, fromPersonId: a.personId, toPersonId: l.toPersonId };
  });
  if (errors.length) throw unprocessable('Data mutasi tidak valid', errors);
  return { rows: rows.filter(Boolean) as NonNullable<(typeof rows)[number]>[], assets };
}

async function names(details: { fromUnitId: string; toUnitId: string; fromLocationId: string; toLocationId: string; fromPersonId: string | null; toPersonId: string | null }[]) {
  const [u, l, p] = await Promise.all([
    prisma.organizationalUnit.findMany({ where: { id: { in: details.flatMap((d) => [d.fromUnitId, d.toUnitId]) } }, select: { id: true, name: true } }),
    prisma.location.findMany({ where: { id: { in: details.flatMap((d) => [d.fromLocationId, d.toLocationId]) } }, select: { id: true, name: true } }),
    prisma.person.findMany({ where: { id: { in: details.flatMap((d) => [d.fromPersonId, d.toPersonId]).filter(Boolean) as string[] } }, select: { id: true, name: true } }),
  ]);
  const m = (x: { id: string; name: string }[]) => new Map(x.map((i) => [i.id, i.name]));
  return { u: m(u), l: m(l), p: m(p) };
}

export async function mutationRoutes(app: FastifyInstance) {
  const idOf = (req: { params: unknown }) => uuid().parse((req.params as { id: string }).id);

  app.get('/mutations', { preHandler: requirePermission('mutations.view') }, async (req) => {
    const q = parseListQuery(req.query, ['number', 'date', 'status', 'createdAt'], 'createdAt', 'desc');
    const f = req.query as Record<string, string | undefined>;
    const where: Prisma.AssetMutationWhereInput = {
      ...(q.search ? { OR: [{ number: { contains: q.search, mode: 'insensitive' } }, { reason: { contains: q.search, mode: 'insensitive' } }, { details: { some: { asset: { code: { contains: q.search, mode: 'insensitive' } } } } }] } : {}),
      ...(f.status ? { status: f.status as never } : {}), ...(f.assetId ? { details: { some: { assetId: uuid().parse(f.assetId) } } } : {}),
    };
    const [rows, total] = await Promise.all([prisma.assetMutation.findMany({ where, include: { _count: { select: { details: true } } }, orderBy: q.orderBy, skip: q.skip, take: q.take }), prisma.assetMutation.count({ where })]);
    return paginated(rows.map(({ _count, ...r }) => ({ ...r, assetCount: _count.details })), total, q.page, q.limit);
  });

  app.post('/mutations', { preHandler: requirePermission('mutations.create') }, async (req, reply) => {
    const input = mutationSchema.parse(req.body);
    const auth = currentUser(req);
    const { rows, assets } = await buildDetails(prisma, input);
    assets.forEach((a) => assertUnitAccess(auth, a.unitId));
    const created = await prisma.$transaction(async (tx) => {
      const number = await nextDocNumber(tx, 'MTS', new Date(input.date));
      const m = await tx.assetMutation.create({ data: { number, date: new Date(input.date), reason: input.reason, createdById: auth.user.id, details: { create: rows } }, include: { details: true } });
      await writeAudit(tx, req, { action: 'CREATE', entityType: 'AssetMutation', entityId: m.id, after: { number, assets: m.details.length } });
      return m;
    });
    return reply.code(201).send(ok(created, `Mutasi ${created.number} dibuat sebagai draft`));
  });

  app.get('/mutations/:id', { preHandler: requirePermission('mutations.view') }, async (req) => {
    const id = idOf(req);
    const m = await prisma.assetMutation.findUnique({ where: { id }, include: { details: { include: { asset: { select: { id: true, code: true, item: { select: { name: true } } } } } } } });
    if (!m) throw notFound('Mutasi tidak ditemukan');
    const n = await names(m.details);
    const creator = await prisma.user.findUnique({ where: { id: m.createdById }, select: { name: true } });
    return ok({
      ...m, createdByName: creator?.name ?? '-', approval: await approvalTimeline('MUTATION', id),
      details: m.details.map((d) => ({ id: d.id, asset: d.asset, from: { unit: n.u.get(d.fromUnitId), location: n.l.get(d.fromLocationId), person: d.fromPersonId ? n.p.get(d.fromPersonId) : null }, to: { unit: n.u.get(d.toUnitId), location: n.l.get(d.toLocationId), person: d.toPersonId ? n.p.get(d.toPersonId) : null } })),
    });
  });

  app.patch('/mutations/:id', { preHandler: requirePermission('mutations.create') }, async (req) => {
    const id = idOf(req);
    const input = mutationSchema.parse(req.body);
    const { rows } = await buildDetails(prisma, input, id);
    const updated = await prisma.$transaction(async (tx) => {
      await lockRows(tx, 'asset_mutations', [id]);
      const before = await tx.assetMutation.findUnique({ where: { id } });
      if (!before) throw notFound('Mutasi tidak ditemukan');
      assertStatus(before.status, EDITABLE, 'Mutasi yang sudah diajukan atau disetujui tidak dapat diedit langsung');
      await tx.assetMutationDetail.deleteMany({ where: { mutationId: id } });
      const m = await tx.assetMutation.update({ where: { id }, data: { date: new Date(input.date), reason: input.reason, status: 'DRAFT', details: { create: rows } }, include: { details: true } });
      await writeAudit(tx, req, { action: 'UPDATE', entityType: 'AssetMutation', entityId: id, before: { reason: before.reason }, after: { reason: m.reason, assets: m.details.length } });
      return m;
    });
    return ok(updated, 'Mutasi diperbarui');
  });

  app.post('/mutations/:id/submit', { preHandler: requirePermission('mutations.submit') }, async (req) => {
    const id = idOf(req);
    const auth = currentUser(req);
    await prisma.$transaction(async (tx) => {
      await lockRows(tx, 'asset_mutations', [id]);
      const m = await tx.assetMutation.findUnique({ where: { id }, include: { details: true } });
      if (!m) throw notFound('Mutasi tidak ditemukan');
      assertStatus(m.status, EDITABLE, 'Hanya draft atau mutasi yang ditolak yang dapat diajukan');
      if (!m.details.length) throw unprocessable('Mutasi belum memiliki aset');
      await lockRows(tx, 'assets', m.details.map((d) => d.assetId));
      // Validasi ulang pada saat diajukan: aset mungkin berubah sejak draft dibuat.
      const assets = await tx.asset.findMany({ where: { id: { in: m.details.map((d) => d.assetId) } } });
      const busy = await tx.assetMutationDetail.findMany({ where: { assetId: { in: assets.map((a) => a.id) }, mutation: { id: { not: id }, status: { in: [...OPEN] } } }, include: { mutation: { select: { number: true } } } });
      const errors = [];
      for (const d of m.details) {
        const a = assets.find((x) => x.id === d.assetId)!;
        if (a.status !== 'AVAILABLE') errors.push({ field: 'lines', message: `${a.code} berstatus ${a.status} dan tidak dapat dimutasi` });
        if (a.locationId !== d.fromLocationId || a.unitId !== d.fromUnitId || a.personId !== d.fromPersonId) errors.push({ field: 'lines', message: `${a.code} sudah berpindah sejak draft dibuat, buat ulang mutasi` });
        const b = busy.find((x) => x.assetId === a.id);
        if (b) errors.push({ field: 'lines', message: `${a.code} sudah ada di mutasi ${b.mutation.number}` });
      }
      if (errors.length) throw conflict('Mutasi tidak dapat diajukan', errors);
      await tx.assetMutation.update({ where: { id }, data: { status: 'PENDING_APPROVAL', submittedAt: new Date() } });
      await submitForApproval(tx, req, { entityType: 'MUTATION', entityId: id, documentNumber: m.number, title: `Mutasi ${m.number}: ${m.details.length} aset. ${m.reason}`, requestedById: auth.user.id });
      await writeAudit(tx, req, { action: 'STATUS_CHANGE', entityType: 'AssetMutation', entityId: id, before: { status: m.status }, after: { status: 'PENDING_APPROVAL' } });
    });
    return ok(null, 'Mutasi diajukan untuk persetujuan');
  });

  app.post('/mutations/:id/cancel', { preHandler: requirePermission('mutations.create') }, async (req) => {
    const id = idOf(req);
    await prisma.$transaction(async (tx) => {
      await lockRows(tx, 'asset_mutations', [id]);
      const m = await tx.assetMutation.findUnique({ where: { id } });
      if (!m) throw notFound('Mutasi tidak ditemukan');
      assertStatus(m.status, ['DRAFT', 'REJECTED', 'APPROVED'] as const, 'Mutasi ini tidak dapat dibatalkan pada status sekarang');
      await tx.assetMutation.update({ where: { id }, data: { status: 'CANCELLED' } });
      await cancelPendingApproval(tx, 'MUTATION', id);
      await writeAudit(tx, req, { action: 'STATUS_CHANGE', entityType: 'AssetMutation', entityId: id, before: { status: m.status }, after: { status: 'CANCELLED' } });
    });
    return ok(null, 'Mutasi dibatalkan');
  });

  app.post('/mutations/:id/move', { preHandler: requirePermission('mutations.complete') }, async (req) => {
    const id = idOf(req);
    await prisma.$transaction(async (tx) => {
      await lockRows(tx, 'asset_mutations', [id]);
      const m = await tx.assetMutation.findUnique({ where: { id } });
      if (!m) throw notFound('Mutasi tidak ditemukan');
      assertStatus(m.status, ['APPROVED'] as const, 'Pemindahan hanya dapat dimulai setelah mutasi disetujui');
      await tx.assetMutation.update({ where: { id }, data: { status: 'IN_TRANSFER', movedAt: new Date() } });
      await writeAudit(tx, req, { action: 'STATUS_CHANGE', entityType: 'AssetMutation', entityId: id, before: { status: 'APPROVED' }, after: { status: 'IN_TRANSFER' } });
    });
    return ok(null, 'Pemindahan dicatat. Konfirmasi setelah barang tiba di tujuan.');
  });

  // Satu-satunya titik yang mengubah lokasi aset akibat mutasi (langkah 1-8 pada SRS 12.3).
  app.post('/mutations/:id/complete', { preHandler: requirePermission('mutations.complete') }, async (req) => {
    const id = idOf(req);
    const auth = currentUser(req);
    const result = await prisma.$transaction(async (tx) => {
      await lockRows(tx, 'asset_mutations', [id]);
      const m = await tx.assetMutation.findUnique({ where: { id }, include: { details: true } });
      if (!m) throw notFound('Mutasi tidak ditemukan');
      assertStatus(m.status, ['IN_TRANSFER'] as const, 'Konfirmasi hanya dapat dilakukan setelah pemindahan dicatat');
      await lockRows(tx, 'assets', m.details.map((d) => d.assetId));
      const moved: string[] = [];
      for (const d of m.details) {
        const a = await tx.asset.findUniqueOrThrow({ where: { id: d.assetId } });
        if (a.status !== 'AVAILABLE') throw conflict(`${a.code} berstatus ${a.status} dan tidak dapat dimutasi`);
        if (a.locationId !== d.fromLocationId || a.unitId !== d.fromUnitId || a.personId !== d.fromPersonId) throw conflict(`${a.code} tidak lagi berada di lokasi asal mutasi`);
        await tx.asset.update({ where: { id: a.id }, data: { unitId: d.toUnitId, locationId: d.toLocationId, personId: d.toPersonId } });
        await tx.assetLocationHistory.create({ data: { assetId: a.id, fromLocationId: d.fromLocationId, toLocationId: d.toLocationId, fromUnitId: d.fromUnitId, toUnitId: d.toUnitId, fromPersonId: d.fromPersonId, toPersonId: d.toPersonId, sourceType: 'MUTATION', sourceId: m.id, note: `Mutasi ${m.number}: ${m.reason}`, changedById: auth.user.id } });
        moved.push(a.code);
      }
      await tx.assetMutation.update({ where: { id }, data: { status: 'COMPLETED', completedAt: new Date(), completedById: auth.user.id } });
      await writeAudit(tx, req, { action: 'MUTATION_COMPLETE', entityType: 'AssetMutation', entityId: id, after: { number: m.number, assets: moved } });
      await notify(tx, [m.createdById].filter((u) => u !== auth.user.id), { type: 'mutation.completed', title: `Mutasi ${m.number} selesai`, body: `${moved.length} aset berpindah lokasi`, entityType: 'MUTATION', entityId: id });
      return moved;
    });
    return ok({ assets: result }, 'Mutasi selesai, lokasi aset diperbarui');
  });
}
