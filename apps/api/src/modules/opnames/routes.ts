import type { FastifyInstance } from 'fastify';
import { Prisma } from '@prisma/client';
import { ROLE_CODES, opnameSchema, opnameScanSchema, opnameSubmitSchema, opnameSyncSchema, opnameVerifySchema, uuid, type OpnameScanInput } from '@sima/shared';
import { prisma } from '../../lib/prisma';
import { ok, paginated } from '../../lib/respond';
import { AppError, conflict, forbidden, notFound, unprocessable } from '../../lib/errors';
import { writeAudit } from '../../lib/audit';
import { assertStatus, lockRows } from '../../lib/doc';
import { nextDocNumber } from '../../lib/sequence';
import { parseListQuery } from '../../lib/list';
import { saveFile } from '../../lib/storage';
import { currentUser, requirePermission, type AuthContext } from '../../plugins/auth';
import { notify, usersWithPermission } from '../notifications/service';

type Tx = Prisma.TransactionClient;
const DECISION_REQUIRED = ['MISMATCH', 'NOT_FOUND', 'UNREGISTERED'] as const;

/** Kode aset dari teks pindaian: URL `/q/KODE` atau kode mentah. */
export function parseAssetCode(raw: string) {
  const m = raw.trim().match(/\/q\/([^/?#\s]+)/i);
  return decodeURIComponent(m ? m[1]! : raw).trim().toUpperCase();
}

export async function locationTreeIds(rootId: string) {
  const ids = [rootId];
  for (let frontier = [rootId]; frontier.length;) {
    const kids = await prisma.location.findMany({ where: { parentId: { in: frontier } }, select: { id: true } });
    frontier = kids.map((k) => k.id).filter((id) => !ids.includes(id));
    ids.push(...frontier);
  }
  return ids;
}

function assertAssignee(auth: AuthContext, assigneeIds: string[]) {
  if (!assigneeIds.includes(auth.user.id) && !auth.roleCodes.has(ROLE_CODES.SUPER_ADMIN)) throw forbidden('Anda bukan petugas pemeriksa pada sesi ini');
}

/** Satu catatan pemeriksaan. Idempoten berdasarkan clientId sehingga kirim ulang dari perangkat offline aman. */
async function recordScan(tx: Tx, opnameId: string, auth: AuthContext, input: OpnameScanInput) {
  const dup = await tx.stockOpnameDetail.findUnique({ where: { opnameId_clientId: { opnameId, clientId: input.clientId } } });
  if (dup) return { status: 'duplicate' as const, detail: dup };

  const opname = await tx.stockOpname.findUniqueOrThrow({ where: { id: opnameId } });
  const code = parseAssetCode(input.code);
  const base = { scannedById: auth.user.id, scannedAt: new Date(), clientId: input.clientId, clientRecordedAt: input.clientRecordedAt ? new Date(input.clientRecordedAt) : null, notes: input.notes };
  const asset = await tx.asset.findUnique({ where: { code } });

  if (!asset) {
    const existing = await tx.stockOpnameDetail.findFirst({ where: { opnameId, assetId: null, scannedCode: code } });
    if (existing) return { status: 'duplicate' as const, detail: existing };
    const detail = await tx.stockOpnameDetail.create({ data: { opnameId, scannedCode: code, result: 'UNREGISTERED', foundLocationId: input.foundLocationId, foundCondition: input.foundCondition, ...base } });
    return { status: 'ok' as const, detail };
  }
  if (asset.status === 'DISPOSED') throw unprocessable(`${asset.code} sudah dihapuskan dan tidak diperiksa`);

  await lockRows(tx, 'assets', [asset.id]);
  const row = await tx.stockOpnameDetail.findUnique({ where: { opnameId_assetId: { opnameId, assetId: asset.id } } });
  const inScope = !!row;
  const expectedLocationId = row?.expectedLocationId ?? asset.locationId;
  const expectedCondition = row?.expectedCondition ?? asset.condition;
  const foundLocationId = input.foundLocationId ?? (inScope ? expectedLocationId : opname.locationId ?? null);
  const foundCondition = input.foundCondition ?? expectedCondition;

  const notes: string[] = [];
  let mismatch = false;
  if (!inScope) { mismatch = true; notes.push('Aset terdaftar di luar lingkup pemeriksaan ini'); }
  if (foundLocationId && foundLocationId !== expectedLocationId) { mismatch = true; notes.push('Lokasi ditemukan berbeda dari data'); }
  if (foundCondition !== expectedCondition) { mismatch = true; notes.push('Kondisi berbeda dari data'); }
  if (asset.status === 'MISSING') { mismatch = true; notes.push('Aset sebelumnya berstatus tidak ditemukan'); }
  const data = { ...base, notes: [input.notes, ...notes].filter(Boolean).join('. ') || null, expectedLocationId, expectedCondition, foundLocationId, foundCondition, result: mismatch ? ('MISMATCH' as const) : ('MATCH' as const) };
  const detail = row
    ? await tx.stockOpnameDetail.update({ where: { id: row.id }, data })
    : await tx.stockOpnameDetail.create({ data: { opnameId, assetId: asset.id, ...data } });
  return { status: 'ok' as const, detail };
}

export async function opnameRoutes(app: FastifyInstance) {
  const idOf = (req: { params: unknown }) => uuid().parse((req.params as { id: string }).id);
  const env = app.config;

  async function loadOpname(id: string) {
    const o = await prisma.stockOpname.findUnique({ where: { id }, include: { assignments: true } });
    if (!o) throw notFound('Sesi stock opname tidak ditemukan');
    return o;
  }
  const lockedInProgress = async (tx: Tx, id: string) => {
    await lockRows(tx, 'stock_opnames', [id]);
    const o = await tx.stockOpname.findUniqueOrThrow({ where: { id }, include: { assignments: true } });
    assertStatus(o.status, ['IN_PROGRESS'] as const, 'Sesi ini tidak sedang dalam pemeriksaan');
    return o;
  };

  app.get('/stock-opnames', { preHandler: requirePermission('stock_opnames.view') }, async (req) => {
    const auth = currentUser(req);
    const q = parseListQuery(req.query, ['number', 'periodStart', 'status', 'createdAt'], 'createdAt', 'desc');
    const f = req.query as Record<string, string | undefined>;
    const where: Prisma.StockOpnameWhereInput = {
      ...(q.search ? { OR: [{ number: { contains: q.search, mode: 'insensitive' } }, { title: { contains: q.search, mode: 'insensitive' } }] } : {}),
      ...(f.status ? { status: f.status as never } : {}),
      ...(f.assigned === 'true' ? { assignments: { some: { userId: auth.user.id } } } : {}),
    };
    const [rows, total] = await Promise.all([prisma.stockOpname.findMany({ where, include: { _count: { select: { details: true } }, assignments: { select: { userId: true } } }, orderBy: q.orderBy, skip: q.skip, take: q.take }), prisma.stockOpname.count({ where })]);
    const checked = await prisma.stockOpnameDetail.groupBy({ by: ['opnameId'], where: { opnameId: { in: rows.map((r) => r.id) }, result: { not: 'NOT_CHECKED' } }, _count: true });
    const done = new Map(checked.map((c) => [c.opnameId, c._count]));
    return paginated(rows.map(({ _count, assignments, ...r }) => ({ ...r, total: _count.details, checked: done.get(r.id) ?? 0, mine: assignments.some((a) => a.userId === auth.user.id) })), total, q.page, q.limit);
  });

  app.post('/stock-opnames', { preHandler: requirePermission('stock_opnames.create') }, async (req, reply) => {
    const input = opnameSchema.parse(req.body);
    const [users, loc, unit] = await Promise.all([
      prisma.user.findMany({ where: { id: { in: input.assigneeIds }, status: 'ACTIVE' } }),
      input.locationId ? prisma.location.findUnique({ where: { id: input.locationId } }) : null,
      input.unitId ? prisma.organizationalUnit.findUnique({ where: { id: input.unitId } }) : null,
    ]);
    const errors = [];
    if (users.length !== new Set(input.assigneeIds).size) errors.push({ field: 'assigneeIds', message: 'Ada petugas yang tidak valid atau nonaktif' });
    if (input.locationId && !loc?.isActive) errors.push({ field: 'locationId', message: 'Lokasi tidak valid atau nonaktif' });
    if (input.unitId && !unit?.isActive) errors.push({ field: 'unitId', message: 'Unit kerja tidak valid atau nonaktif' });
    if (errors.length) throw unprocessable('Data sesi tidak valid', errors);
    const created = await prisma.$transaction(async (tx) => {
      const number = await nextDocNumber(tx, 'SOP', new Date(input.periodStart));
      const o = await tx.stockOpname.create({
        data: { number, title: input.title, periodStart: new Date(input.periodStart), periodEnd: new Date(input.periodEnd), locationId: input.locationId, unitId: input.unitId, notes: input.notes, createdById: currentUser(req).user.id, assignments: { create: [...new Set(input.assigneeIds)].map((userId) => ({ userId })) } },
      });
      await writeAudit(tx, req, { action: 'CREATE', entityType: 'StockOpname', entityId: o.id, after: { number, title: o.title, assignees: input.assigneeIds } });
      return o;
    });
    return reply.code(201).send(ok(created, `Sesi ${created.number} dibuat`));
  });

  app.get('/stock-opnames/:id', { preHandler: requirePermission('stock_opnames.view') }, async (req) => {
    const id = idOf(req);
    const o = await loadOpname(id);
    const [counts, people, creator, verifier, loc, unit] = await Promise.all([
      prisma.stockOpnameDetail.groupBy({ by: ['result'], where: { opnameId: id }, _count: true }),
      prisma.user.findMany({ where: { id: { in: o.assignments.map((a) => a.userId) } }, select: { id: true, name: true } }),
      prisma.user.findUnique({ where: { id: o.createdById }, select: { name: true } }),
      o.verifiedById ? prisma.user.findUnique({ where: { id: o.verifiedById }, select: { name: true } }) : null,
      o.locationId ? prisma.location.findUnique({ where: { id: o.locationId }, select: { name: true } }) : null,
      o.unitId ? prisma.organizationalUnit.findUnique({ where: { id: o.unitId }, select: { name: true } }) : null,
    ]);
    const summary = Object.fromEntries(['MATCH', 'MISMATCH', 'NOT_FOUND', 'NOT_CHECKED', 'UNREGISTERED'].map((r) => [r, counts.find((c) => c.result === r)?._count ?? 0]));
    const { assignments, ...rest } = o;
    return ok({ ...rest, assignees: people, createdByName: creator?.name ?? '-', verifiedByName: verifier?.name ?? null, locationName: loc?.name ?? null, unitName: unit?.name ?? null, summary, total: Object.values(summary).reduce((a, b) => a + b, 0) });
  });

  app.get('/stock-opnames/:id/details', { preHandler: requirePermission('stock_opnames.view') }, async (req) => {
    const id = idOf(req);
    await loadOpname(id);
    const q = parseListQuery(req.query, ['result', 'scannedAt'], 'result');
    const f = req.query as Record<string, string | undefined>;
    const where: Prisma.StockOpnameDetailWhereInput = {
      opnameId: id,
      ...(f.findings === 'true' ? { result: { in: [...DECISION_REQUIRED] } } : f.result && ['MATCH', 'MISMATCH', 'NOT_FOUND', 'NOT_CHECKED', 'UNREGISTERED'].includes(f.result) ? { result: f.result as never } : {}),
      ...(q.search ? { OR: [{ scannedCode: { contains: q.search, mode: 'insensitive' } }, { asset: { code: { contains: q.search, mode: 'insensitive' } } }, { asset: { item: { name: { contains: q.search, mode: 'insensitive' } } } }] } : {}),
    };
    const [rows, total] = await Promise.all([
      prisma.stockOpnameDetail.findMany({ where, include: { asset: { select: { id: true, code: true, status: true, item: { select: { name: true } } } }, photos: { select: { id: true, fileId: true } } }, orderBy: [{ result: 'asc' }, { id: 'asc' }], skip: q.skip, take: q.take }),
      prisma.stockOpnameDetail.count({ where }),
    ]);
    const locIds = [...new Set(rows.flatMap((r) => [r.expectedLocationId, r.foundLocationId]).filter(Boolean) as string[])];
    const locs = await prisma.location.findMany({ where: { id: { in: locIds } }, select: { id: true, name: true } });
    const name = new Map(locs.map((l) => [l.id, l.name]));
    return paginated(rows.map((r) => ({ ...r, expectedLocation: r.expectedLocationId ? name.get(r.expectedLocationId) ?? null : null, foundLocation: r.foundLocationId ? name.get(r.foundLocationId) ?? null : null })), total, q.page, q.limit);
  });

  app.post('/stock-opnames/:id/start', { preHandler: requirePermission('stock_opnames.create') }, async (req) => {
    const id = idOf(req);
    const total = await prisma.$transaction(async (tx) => {
      await lockRows(tx, 'stock_opnames', [id]);
      const o = await tx.stockOpname.findUnique({ where: { id }, include: { assignments: true } });
      if (!o) throw notFound('Sesi stock opname tidak ditemukan');
      assertStatus(o.status, ['DRAFT'] as const, 'Sesi ini sudah dimulai atau dibatalkan');
      const locIds = o.locationId ? await locationTreeIds(o.locationId) : null;
      const assets = await tx.asset.findMany({ where: { status: { not: 'DISPOSED' }, archivedAt: null, ...(locIds ? { locationId: { in: locIds } } : {}), ...(o.unitId ? { unitId: o.unitId } : {}) }, select: { id: true, locationId: true, condition: true } });
      if (!assets.length) throw unprocessable('Tidak ada aset pada lingkup pemeriksaan ini');
      // Snapshot kondisi data saat sesi dimulai: pembanding tetap walau master berubah selama pemeriksaan.
      await tx.stockOpnameDetail.createMany({ data: assets.map((a) => ({ opnameId: id, assetId: a.id, expectedLocationId: a.locationId, expectedCondition: a.condition })) });
      await tx.stockOpname.update({ where: { id }, data: { status: 'IN_PROGRESS', startedAt: new Date() } });
      await notify(tx, o.assignments.map((a) => a.userId), { type: 'opname.assigned', title: `Anda ditugaskan memeriksa: ${o.title}`, body: `${assets.length} aset, ${o.number}`, entityType: 'STOCK_OPNAME', entityId: id });
      await writeAudit(tx, req, { action: 'OPNAME_START', entityType: 'StockOpname', entityId: id, after: { number: o.number, assets: assets.length } });
      return assets.length;
    });
    return ok({ total }, `Pemeriksaan dimulai: ${total} aset`);
  });

  app.post('/stock-opnames/:id/scan', { preHandler: requirePermission('stock_opnames.scan') }, async (req) => {
    const id = idOf(req);
    const input = opnameScanSchema.parse(req.body);
    const auth = currentUser(req);
    const r = await prisma.$transaction(async (tx) => {
      const o = await lockedInProgress(tx, id);
      assertAssignee(auth, o.assignments.map((a) => a.userId));
      return recordScan(tx, id, auth, input);
    });
    return ok(r, r.status === 'duplicate' ? 'Catatan sudah tersimpan sebelumnya' : 'Hasil pemeriksaan dicatat');
  });

  // Sinkronisasi batch dari perangkat offline. Setiap catatan diproses terpisah; yang gagal dilaporkan sebagai konflik.
  app.post('/stock-opnames/:id/sync', { preHandler: requirePermission('stock_opnames.scan') }, async (req) => {
    const id = idOf(req);
    const { records } = opnameSyncSchema.parse(req.body);
    const auth = currentUser(req);
    const o = await loadOpname(id);
    assertAssignee(auth, o.assignments.map((a) => a.userId));
    const results: { clientId: string; status: 'ok' | 'duplicate' | 'conflict'; result?: string; message?: string }[] = [];
    for (const rec of records) {
      try {
        const r = await prisma.$transaction(async (tx) => { await lockedInProgress(tx, id); return recordScan(tx, id, auth, rec); });
        results.push({ clientId: rec.clientId, status: r.status, result: r.detail.result });
      } catch (e) {
        results.push({ clientId: rec.clientId, status: 'conflict', message: e instanceof AppError ? e.message : 'Gagal menyimpan catatan' });
      }
    }
    return ok({ results, accepted: results.filter((r) => r.status !== 'conflict').length, conflicts: results.filter((r) => r.status === 'conflict').length }, 'Sinkronisasi selesai');
  });

  app.post('/stock-opnames/:id/details/:detailId/photos', { preHandler: requirePermission('stock_opnames.scan') }, async (req, reply) => {
    const id = idOf(req);
    const detailId = uuid().parse((req.params as { detailId: string }).detailId);
    const auth = currentUser(req);
    const o = await loadOpname(id);
    assertStatus(o.status, ['IN_PROGRESS'] as const, 'Foto hanya dapat ditambahkan saat pemeriksaan berlangsung');
    assertAssignee(auth, o.assignments.map((a) => a.userId));
    const detail = await prisma.stockOpnameDetail.findFirst({ where: { id: detailId, opnameId: id }, include: { _count: { select: { photos: true } } } });
    if (!detail) throw notFound('Detail pemeriksaan tidak ditemukan');
    if (detail._count.photos >= 5) throw unprocessable('Maksimal 5 foto per aset');
    const part = await req.file();
    if (!part) throw unprocessable('File foto wajib dilampirkan');
    let buffer: Buffer;
    try { buffer = await part.toBuffer(); } catch { throw new AppError(413, `Ukuran file melebihi ${env.MAX_UPLOAD_MB} MB`, 'FILE_TOO_LARGE'); }
    const photo = await prisma.$transaction(async (tx) => {
      const file = await saveFile(tx, env, { buffer, originalName: part.filename, userId: auth.user.id, kinds: ['image'] });
      const p = await tx.stockOpnamePhoto.create({ data: { detailId, fileId: file.id } });
      await writeAudit(tx, req, { action: 'PHOTO_ADD', entityType: 'StockOpname', entityId: id, after: { detailId, fileId: file.id } });
      return p;
    });
    return reply.code(201).send(ok(photo, 'Foto pemeriksaan ditambahkan'));
  });

  app.post('/stock-opnames/:id/submit', { preHandler: requirePermission('stock_opnames.submit') }, async (req) => {
    const id = idOf(req);
    const auth = currentUser(req);
    const input = opnameSubmitSchema.parse(req.body ?? {});
    const summary = await prisma.$transaction(async (tx) => {
      const o = await lockedInProgress(tx, id);
      assertAssignee(auth, o.assignments.map((a) => a.userId));
      const unchecked = await tx.stockOpnameDetail.count({ where: { opnameId: id, result: 'NOT_CHECKED' } });
      if (unchecked && !input.markUncheckedAsNotFound) {
        throw unprocessable(`Masih ada ${unchecked} aset belum diperiksa`, [{ field: 'markUncheckedAsNotFound', message: `${unchecked} aset belum diperiksa. Periksa dulu, atau tandai sebagai tidak ditemukan.` }]);
      }
      if (unchecked) await tx.stockOpnameDetail.updateMany({ where: { opnameId: id, result: 'NOT_CHECKED' }, data: { result: 'NOT_FOUND', scannedById: auth.user.id, scannedAt: new Date(), notes: 'Tidak ditemukan saat pemeriksaan' } });
      await tx.stockOpname.update({ where: { id }, data: { status: 'SUBMITTED', submittedAt: new Date() } });
      const verifiers = await usersWithPermission(tx, 'stock_opnames.verify', { excludeUserId: auth.user.id });
      await notify(tx, verifiers, { type: 'opname.submitted', title: `Hasil pemeriksaan ${o.number} menunggu verifikasi`, body: o.title, entityType: 'STOCK_OPNAME', entityId: id });
      await writeAudit(tx, req, { action: 'OPNAME_SUBMIT', entityType: 'StockOpname', entityId: id, after: { number: o.number, markedNotFound: unchecked } });
      return { markedNotFound: unchecked };
    });
    return ok(summary, 'Hasil pemeriksaan diajukan untuk verifikasi');
  });

  // Verifikasi: hanya di sini hasil yang tidak sesuai boleh mengubah master aset.
  app.post('/stock-opnames/:id/verify', { preHandler: requirePermission('stock_opnames.verify') }, async (req) => {
    const id = idOf(req);
    const auth = currentUser(req);
    const input = opnameVerifySchema.parse(req.body ?? {});
    const result = await prisma.$transaction(async (tx) => {
      await lockRows(tx, 'stock_opnames', [id]);
      const o = await tx.stockOpname.findUnique({ where: { id }, include: { assignments: true } });
      if (!o) throw notFound('Sesi stock opname tidak ditemukan');
      assertStatus(o.status, ['SUBMITTED'] as const, 'Hanya hasil yang sudah diajukan yang dapat diverifikasi');
      if ((o.createdById === auth.user.id || o.assignments.some((a) => a.userId === auth.user.id)) && !auth.roleCodes.has(ROLE_CODES.SUPER_ADMIN)) {
        throw forbidden('Verifikasi harus dilakukan oleh orang yang tidak membuat sesi atau memeriksa di lapangan');
      }
      const details = await tx.stockOpnameDetail.findMany({ where: { opnameId: id, result: { in: [...DECISION_REQUIRED] } }, include: { asset: true } });
      const decided = new Map(input.decisions.map((d) => [d.detailId, d.decision]));
      const undecided = details.filter((d) => !decided.has(d.id));
      if (undecided.length) throw unprocessable(`${undecided.length} temuan belum diputuskan`, [{ field: 'decisions', message: `Putuskan terapkan atau tolak untuk ${undecided.length} temuan yang tidak sesuai` }]);
      await lockRows(tx, 'assets', details.flatMap((d) => (d.assetId ? [d.assetId] : [])));

      let applied = 0, rejected = 0;
      for (const d of details) {
        const decision = decided.get(d.id)!;
        await tx.stockOpnameDetail.update({ where: { id: d.id }, data: { decision, decidedById: auth.user.id, decidedAt: new Date(), appliedAt: decision === 'APPLY' ? new Date() : null } });
        if (decision === 'REJECT') { rejected++; continue; }
        applied++;
        const a = d.asset;
        if (!a) continue; // barang tidak terdaftar: diakui, pendaftaran dilakukan manual
        const fresh = await tx.asset.findUniqueOrThrow({ where: { id: a.id } });
        if (fresh.status === 'DISPOSED') throw conflict(`${fresh.code} sudah dihapuskan dan tidak dapat diubah`);
        const note = `Stock opname ${o.number}`;
        if (d.result === 'NOT_FOUND') {
          if (fresh.status !== 'AVAILABLE') throw conflict(`${fresh.code} berstatus ${fresh.status}; tolak temuan ini atau selesaikan transaksinya dulu`);
          await tx.asset.update({ where: { id: fresh.id }, data: { status: 'MISSING' } });
          await tx.assetConditionHistory.create({ data: { assetId: fresh.id, fromCondition: fresh.condition, toCondition: fresh.condition, fromStatus: fresh.status, toStatus: 'MISSING', sourceType: 'OPNAME', sourceId: id, note: `${note}: tidak ditemukan`, changedById: auth.user.id } });
        } else {
          const newLoc = d.foundLocationId && d.foundLocationId !== fresh.locationId ? d.foundLocationId : null;
          const newCond = d.foundCondition && d.foundCondition !== fresh.condition ? d.foundCondition : null;
          const newStatus = fresh.status === 'MISSING' ? 'AVAILABLE' : fresh.status;
          if (newLoc || newCond || newStatus !== fresh.status) {
            await tx.asset.update({ where: { id: fresh.id }, data: { ...(newLoc ? { locationId: newLoc } : {}), ...(newCond ? { condition: newCond } : {}), status: newStatus } });
            if (newLoc) await tx.assetLocationHistory.create({ data: { assetId: fresh.id, fromLocationId: fresh.locationId, toLocationId: newLoc, fromUnitId: fresh.unitId, toUnitId: fresh.unitId, fromPersonId: fresh.personId, toPersonId: fresh.personId, sourceType: 'OPNAME', sourceId: id, note, changedById: auth.user.id } });
            if (newCond || newStatus !== fresh.status) await tx.assetConditionHistory.create({ data: { assetId: fresh.id, fromCondition: fresh.condition, toCondition: newCond ?? fresh.condition, fromStatus: fresh.status, toStatus: newStatus, sourceType: 'OPNAME', sourceId: id, note, changedById: auth.user.id } });
          }
        }
      }
      await tx.stockOpname.update({ where: { id }, data: { status: 'VERIFIED', verifiedAt: new Date(), verifiedById: auth.user.id, notes: input.note ? [o.notes, `Verifikasi: ${input.note}`].filter(Boolean).join('\n') : o.notes } });
      await writeAudit(tx, req, { action: 'OPNAME_VERIFY', entityType: 'StockOpname', entityId: id, after: { number: o.number, applied, rejected, note: input.note } });
      await notify(tx, [o.createdById, ...o.assignments.map((a) => a.userId)].filter((u) => u !== auth.user.id), { type: 'opname.verified', title: `Hasil pemeriksaan ${o.number} terverifikasi`, body: `${applied} temuan diterapkan, ${rejected} ditolak`, entityType: 'STOCK_OPNAME', entityId: id });
      return { applied, rejected };
    });
    return ok(result, 'Hasil pemeriksaan diverifikasi');
  });

  app.post('/stock-opnames/:id/cancel', { preHandler: requirePermission('stock_opnames.create') }, async (req) => {
    const id = idOf(req);
    await prisma.$transaction(async (tx) => {
      await lockRows(tx, 'stock_opnames', [id]);
      const o = await tx.stockOpname.findUnique({ where: { id } });
      if (!o) throw notFound('Sesi stock opname tidak ditemukan');
      assertStatus(o.status, ['DRAFT', 'IN_PROGRESS', 'SUBMITTED'] as const, 'Sesi ini sudah final dan tidak dapat dibatalkan');
      await tx.stockOpname.update({ where: { id }, data: { status: 'CANCELLED' } });
      await writeAudit(tx, req, { action: 'STATUS_CHANGE', entityType: 'StockOpname', entityId: id, before: { status: o.status }, after: { status: 'CANCELLED' } });
    });
    return ok(null, 'Sesi dibatalkan. Data master aset tidak berubah.');
  });
}
