import type { FastifyInstance } from 'fastify';
import type { Prisma } from '@prisma/client';
import QRCode from 'qrcode';
import { bulkQrSchema, registerAssetsSchema, updateAssetSchema, uuid } from '@sima/shared';
import { prisma } from '../../lib/prisma';
import { ok, paginated } from '../../lib/respond';
import { AppError, conflict, forbidden, notFound, unprocessable } from '../../lib/errors';
import { writeAudit } from '../../lib/audit';
import { nextSequence, pad } from '../../lib/sequence';
import { parseBool, parseListQuery } from '../../lib/list';
import { assertUnitAccess, unitScope } from '../../lib/scope';
import { removeStoredFile, saveFile } from '../../lib/storage';
import { currentUser, requirePermission } from '../../plugins/auth';

const listInclude = {
  item: { select: { id: true, code: true, name: true, category: { select: { id: true, name: true } } } },
  unit: { select: { id: true, name: true } },
  location: { select: { id: true, code: true, name: true } },
  person: { select: { id: true, name: true } },
} satisfies Prisma.AssetInclude;

const detailInclude = {
  item: { include: { category: true, brand: true, unitOfMeasure: true } },
  unit: true,
  location: { include: { parent: { include: { parent: true } } } },
  person: true,
  fundingSource: true,
  vendor: true,
  photos: { orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }] },
} satisfies Prisma.AssetInclude;

const snapshot = (a: { id: string; code: string; itemId: string; serialNumber: string | null; condition: string; status: string; unitId: string; locationId: string; personId: string | null; acquisitionCost: unknown; acquisitionYear: number; notes: string | null }) => ({
  id: a.id, code: a.code, itemId: a.itemId, serialNumber: a.serialNumber, condition: a.condition, status: a.status,
  unitId: a.unitId, locationId: a.locationId, personId: a.personId, acquisitionCost: String(a.acquisitionCost), acquisitionYear: a.acquisitionYear, notes: a.notes,
});

export const qrUrl = (appUrl: string, code: string) => `${appUrl.replace(/\/$/, '')}/q/${encodeURIComponent(code)}`;

async function loadAsset(req: import('fastify').FastifyRequest, id: string) {
  const asset = await prisma.asset.findUnique({ where: { id }, include: detailInclude });
  if (!asset) throw notFound('Aset tidak ditemukan');
  assertUnitAccess(currentUser(req), asset.unitId);
  return asset;
}

export async function assetRoutes(app: FastifyInstance) {
  const env = app.config;
  const idOf = (req: { params: unknown }) => uuid('Aset').parse((req.params as { id: string }).id);

  app.get('/assets', { preHandler: requirePermission('assets.view') }, async (req) => {
    const q = parseListQuery(req.query, ['code', 'itemName', 'acquisitionYear', 'condition', 'status', 'createdAt'], 'code');
    const f = req.query as Record<string, string | undefined>;
    const sortBy = Object.keys(q.orderBy)[0]!;
    const orderBy = sortBy === 'itemName' ? { item: { name: q.orderBy[sortBy]! } } : q.orderBy;
    const archived = parseBool(f.includeArchived);
    const where: Prisma.AssetWhereInput = {
      ...unitScope(currentUser(req)),
      ...(archived ? {} : { archivedAt: null }),
      ...(q.search ? { OR: [
        { code: { contains: q.search, mode: 'insensitive' } }, { serialNumber: { contains: q.search, mode: 'insensitive' } },
        { item: { name: { contains: q.search, mode: 'insensitive' } } },
      ] } : {}),
      ...(f.itemId ? { itemId: uuid().parse(f.itemId) } : {}),
      ...(f.categoryId ? { item: { categoryId: uuid().parse(f.categoryId) } } : {}),
      ...(f.condition && ['GOOD', 'MINOR_DAMAGE', 'MAJOR_DAMAGE'].includes(f.condition) ? { condition: f.condition as never } : {}),
      ...(f.status && ['AVAILABLE', 'LOANED', 'UNDER_MAINTENANCE', 'MISSING', 'DISPOSED'].includes(f.status) ? { status: f.status as never } : {}),
      ...(f.locationId ? { locationId: uuid().parse(f.locationId) } : {}),
      ...(f.personId ? { personId: uuid().parse(f.personId) } : {}),
      ...(f.acquisitionYear ? { acquisitionYear: Number(f.acquisitionYear) || undefined } : {}),
    };
    // Filter unit eksplisit hanya boleh mempersempit hasil, tidak melebihi akses pengguna.
    if (f.unitId) where.AND = [{ unitId: uuid().parse(f.unitId) }];
    const [rows, total] = await Promise.all([
      prisma.asset.findMany({ where, include: listInclude, orderBy, skip: q.skip, take: q.take }),
      prisma.asset.count({ where }),
    ]);
    return paginated(rows, total, q.page, q.limit);
  });

  app.post('/assets', { preHandler: requirePermission('assets.create') }, async (req, reply) => {
    const auth = currentUser(req);
    const input = registerAssetsSchema.parse(req.body);
    assertUnitAccess(auth, input.unitId);

    const item = await prisma.item.findUnique({ where: { id: input.itemId }, include: { category: true } });
    if (!item) throw unprocessable('Barang tidak ditemukan', [{ field: 'itemId', message: 'Barang tidak ditemukan' }]);
    if (item.type !== 'ASSET') throw unprocessable('Hanya barang inventaris yang dapat didaftarkan sebagai aset', [{ field: 'itemId', message: 'Barang ini adalah persediaan' }]);
    if (!item.isActive) throw unprocessable('Barang sudah diarsipkan', [{ field: 'itemId', message: 'Barang sudah diarsipkan' }]);

    const [unit, location, person] = await Promise.all([
      prisma.organizationalUnit.findUnique({ where: { id: input.unitId } }),
      prisma.location.findUnique({ where: { id: input.locationId } }),
      input.personId ? prisma.person.findUnique({ where: { id: input.personId } }) : null,
    ]);
    const refErrors = [];
    if (!unit?.isActive) refErrors.push({ field: 'unitId', message: 'Unit tidak valid atau nonaktif' });
    if (!location?.isActive) refErrors.push({ field: 'locationId', message: 'Lokasi tidak valid atau nonaktif' });
    if (input.personId && !person?.isActive) refErrors.push({ field: 'personId', message: 'Penanggung jawab tidak valid atau nonaktif' });
    if (refErrors.length) throw unprocessable('Referensi tidak valid', refErrors);

    const serials = input.serialNumbers.map((s) => s.trim());
    if (serials.length && serials.length !== input.quantity) {
      throw unprocessable('Jumlah nomor seri tidak sama dengan jumlah unit', [{ field: 'serialNumbers', message: `Isi ${input.quantity} nomor seri (satu per unit) atau kosongkan semuanya` }]);
    }
    const filled = serials.filter(Boolean);
    if (new Set(filled.map((s) => s.toLowerCase())).size !== filled.length) {
      throw unprocessable('Nomor seri ganda', [{ field: 'serialNumbers', message: 'Ada nomor seri yang sama dalam daftar' }]);
    }

    const created = await prisma.$transaction(async (tx) => {
      const out = [];
      for (let i = 0; i < input.quantity; i++) {
        const seq = await nextSequence(tx, 'ASSET');
        const code = `INV-${item.category.codePrefix}-${input.acquisitionYear}-${pad(seq)}`;
        const asset = await tx.asset.create({
          data: {
            code, itemId: item.id, serialNumber: serials[i] || null, acquisitionDate: input.acquisitionDate ? new Date(input.acquisitionDate) : null,
            acquisitionYear: input.acquisitionYear, fundingSourceId: input.fundingSourceId, vendorId: input.vendorId,
            acquisitionCost: input.acquisitionCost, condition: input.condition, status: 'AVAILABLE', unitId: input.unitId,
            locationId: input.locationId, personId: input.personId, notes: input.notes, createdById: auth.user.id,
          },
          include: listInclude,
        });
        await tx.assetLocationHistory.create({ data: { assetId: asset.id, toLocationId: asset.locationId, toUnitId: asset.unitId, toPersonId: asset.personId, sourceType: 'REGISTRATION', note: 'Registrasi aset', changedById: auth.user.id } });
        await tx.assetConditionHistory.create({ data: { assetId: asset.id, toCondition: asset.condition, toStatus: 'AVAILABLE', sourceType: 'REGISTRATION', note: 'Registrasi aset', changedById: auth.user.id } });
        await writeAudit(tx, req, { action: 'CREATE', entityType: 'Asset', entityId: asset.id, after: snapshot(asset) });
        out.push(asset);
      }
      return out;
    });
    return reply.code(201).send(ok(created, `${created.length} aset berhasil didaftarkan`));
  });

  app.get('/assets/by-code/:code', { preHandler: requirePermission('assets.view') }, async (req) => {
    const code = decodeURIComponent((req.params as { code: string }).code).trim().toUpperCase();
    const asset = await prisma.asset.findUnique({ where: { code }, select: { id: true, code: true, status: true, unitId: true, item: { select: { name: true } } } });
    if (!asset) throw notFound('QR Code tidak dikenal: aset dengan kode ini tidak terdaftar');
    assertUnitAccess(currentUser(req), asset.unitId);
    return ok({ id: asset.id, code: asset.code, status: asset.status, name: asset.item.name });
  });

  app.get('/assets/:id', { preHandler: requirePermission('assets.view') }, async (req) => ok(await loadAsset(req, idOf(req))));

  app.patch('/assets/:id', { preHandler: requirePermission('assets.update') }, async (req) => {
    const id = idOf(req);
    const before = await loadAsset(req, id);
    if (before.status === 'DISPOSED') throw unprocessable('Aset yang sudah dihapuskan tidak dapat diubah');
    const input = updateAssetSchema.parse(req.body);
    const condChanged = input.condition !== before.condition;
    if (condChanged && !input.conditionNote) throw unprocessable('Alasan perubahan kondisi wajib diisi', [{ field: 'conditionNote', message: 'Isi alasan perubahan kondisi' }]);
    const { conditionNote, ...data } = input;
    const after = await prisma.$transaction(async (tx) => {
      const a = await tx.asset.update({ where: { id }, data: { ...data, acquisitionDate: data.acquisitionDate ? new Date(data.acquisitionDate) : null }, include: detailInclude });
      if (condChanged) {
        await tx.assetConditionHistory.create({ data: { assetId: id, fromCondition: before.condition, toCondition: a.condition, fromStatus: before.status, toStatus: a.status, sourceType: 'EDIT', note: conditionNote, changedById: currentUser(req).user.id } });
      }
      await writeAudit(tx, req, { action: 'UPDATE', entityType: 'Asset', entityId: id, before: snapshot(before), after: snapshot(a) });
      return a;
    });
    return ok(after, 'Aset diperbarui');
  });

  app.get('/assets/:id/history', { preHandler: requirePermission('assets.view') }, async (req) => {
    const id = idOf(req);
    await loadAsset(req, id);
    const [location, condition, loans, maintenances] = await Promise.all([
      prisma.assetLocationHistory.findMany({ where: { assetId: id }, orderBy: { changedAt: 'desc' } }),
      prisma.assetConditionHistory.findMany({ where: { assetId: id }, orderBy: { changedAt: 'desc' } }),
      prisma.loanDetail.findMany({ where: { assetId: id }, include: { loan: { include: { borrower: { select: { name: true } } } } }, orderBy: { loan: { createdAt: 'desc' } } }),
      prisma.maintenance.findMany({ where: { assetId: id }, orderBy: { date: 'desc' } }),
    ]);
    // Nama lokasi/unit/orang untuk tampilan; satu query per jenis.
    const locIds = [...new Set(location.flatMap((l) => [l.fromLocationId, l.toLocationId]).filter(Boolean) as string[])];
    const unitIds = [...new Set(location.flatMap((l) => [l.fromUnitId, l.toUnitId]).filter(Boolean) as string[])];
    const personIds = [...new Set(location.flatMap((l) => [l.fromPersonId, l.toPersonId]).filter(Boolean) as string[])];
    const [locs, units, persons] = await Promise.all([
      prisma.location.findMany({ where: { id: { in: locIds } }, select: { id: true, name: true } }),
      prisma.organizationalUnit.findMany({ where: { id: { in: unitIds } }, select: { id: true, name: true } }),
      prisma.person.findMany({ where: { id: { in: personIds } }, select: { id: true, name: true } }),
    ]);
    const name = (list: { id: string; name: string }[]) => new Map(list.map((x) => [x.id, x.name]));
    const L = name(locs), U = name(units), P = name(persons);
    return ok({
      location: location.map((l) => ({ ...l, fromLocation: l.fromLocationId ? L.get(l.fromLocationId) ?? null : null, toLocation: L.get(l.toLocationId) ?? null, fromUnit: l.fromUnitId ? U.get(l.fromUnitId) ?? null : null, toUnit: l.toUnitId ? U.get(l.toUnitId) ?? null : null, fromPerson: l.fromPersonId ? P.get(l.fromPersonId) ?? null : null, toPerson: l.toPersonId ? P.get(l.toPersonId) ?? null : null })),
      condition, loans, maintenances,
    });
  });

  // ---- QR Code
  app.get('/assets/:id/qr', { preHandler: requirePermission('assets.view') }, async (req, reply) => {
    const asset = await loadAsset(req, idOf(req));
    const { format, download } = req.query as { format?: string; download?: string };
    const url = qrUrl(env.APP_URL, asset.code);
    const opts = { margin: 2, errorCorrectionLevel: 'M' as const };
    if (download) reply.header('content-disposition', `attachment; filename="${asset.code}.${format === 'svg' ? 'svg' : 'png'}"`);
    reply.header('cache-control', 'private, max-age=300');
    if (format === 'svg') return reply.type('image/svg+xml').send(await QRCode.toString(url, { ...opts, type: 'svg' }));
    return reply.type('image/png').send(await QRCode.toBuffer(url, { ...opts, type: 'png', width: 512 }));
  });

  app.post('/assets/bulk-qr', { preHandler: requirePermission('assets.print_qr') }, async (req) => {
    const { assetIds } = bulkQrSchema.parse(req.body);
    const ids = [...new Set(assetIds)];
    const assets = await prisma.asset.findMany({ where: { id: { in: ids }, ...unitScope(currentUser(req)) }, include: { item: { select: { name: true } }, location: { select: { name: true } }, unit: { select: { name: true } } }, orderBy: { code: 'asc' } });
    if (assets.length !== ids.length) throw notFound('Sebagian aset tidak ditemukan atau di luar akses Anda');
    const labels = await Promise.all(assets.map(async (a) => ({
      id: a.id, code: a.code, name: a.item.name, location: a.location.name, unit: a.unit.name, status: a.status,
      qr: await QRCode.toDataURL(qrUrl(env.APP_URL, a.code), { margin: 1, errorCorrectionLevel: 'M', width: 320 }),
    })));
    await writeAudit(prisma, req, { action: 'PRINT_QR', entityType: 'Asset', after: { count: labels.length, codes: labels.map((l) => l.code) } });
    return ok(labels);
  });

  // ---- Foto
  app.post('/assets/:id/photos', { preHandler: requirePermission('assets.update') }, async (req, reply) => {
    const id = idOf(req);
    const asset = await loadAsset(req, id);
    if (asset.status === 'DISPOSED') throw unprocessable('Aset yang sudah dihapuskan tidak dapat diubah');
    if (asset.photos.length >= 10) throw unprocessable('Maksimal 10 foto per aset');
    const part = await req.file();
    if (!part) throw unprocessable('File foto wajib dilampirkan');
    let buffer: Buffer;
    try {
      buffer = await part.toBuffer();
    } catch {
      throw new AppError(413, `Ukuran file melebihi ${env.MAX_UPLOAD_MB} MB`, 'FILE_TOO_LARGE');
    }
    const caption = typeof (part.fields.caption as { value?: unknown } | undefined)?.value === 'string' ? ((part.fields.caption as { value: string }).value).slice(0, 200) : null;
    const photo = await prisma.$transaction(async (tx) => {
      const file = await saveFile(tx, env, { buffer, originalName: part.filename, userId: currentUser(req).user.id, kinds: ['image'] });
      const p = await tx.assetPhoto.create({ data: { assetId: id, fileId: file.id, caption, isPrimary: asset.photos.length === 0 } });
      await writeAudit(tx, req, { action: 'PHOTO_ADD', entityType: 'Asset', entityId: id, after: { photoId: p.id, fileId: file.id } });
      return p;
    });
    return reply.code(201).send(ok(photo, 'Foto ditambahkan'));
  });

  app.post('/assets/:id/photos/:photoId/primary', { preHandler: requirePermission('assets.update') }, async (req) => {
    const id = idOf(req);
    await loadAsset(req, id);
    const photoId = uuid().parse((req.params as { photoId: string }).photoId);
    const photo = await prisma.assetPhoto.findFirst({ where: { id: photoId, assetId: id } });
    if (!photo) throw notFound('Foto tidak ditemukan');
    await prisma.$transaction([
      prisma.assetPhoto.updateMany({ where: { assetId: id }, data: { isPrimary: false } }),
      prisma.assetPhoto.update({ where: { id: photoId }, data: { isPrimary: true } }),
    ]);
    return ok(null, 'Foto utama diubah');
  });

  app.delete('/assets/:id/photos/:photoId', { preHandler: requirePermission('assets.update') }, async (req) => {
    const id = idOf(req);
    const asset = await loadAsset(req, id);
    if (asset.status === 'DISPOSED') throw forbidden('Aset yang sudah dihapuskan tidak dapat diubah');
    const photoId = uuid().parse((req.params as { photoId: string }).photoId);
    const photo = await prisma.assetPhoto.findFirst({ where: { id: photoId, assetId: id }, include: { file: true } });
    if (!photo) throw notFound('Foto tidak ditemukan');
    await prisma.$transaction(async (tx) => {
      await tx.assetPhoto.delete({ where: { id: photoId } });
      if (photo.isPrimary) {
        const next = await tx.assetPhoto.findFirst({ where: { assetId: id }, orderBy: { createdAt: 'asc' } });
        if (next) await tx.assetPhoto.update({ where: { id: next.id }, data: { isPrimary: true } });
      }
      await writeAudit(tx, req, { action: 'PHOTO_REMOVE', entityType: 'Asset', entityId: id, before: { photoId, fileId: photo.fileId } });
    });
    // File fisik dihapus hanya bila tidak dipakai entitas lain (foto opname, lampiran).
    const used = (await prisma.assetPhoto.count({ where: { fileId: photo.fileId } })) + (await prisma.stockOpnamePhoto.count({ where: { fileId: photo.fileId } })) + (await prisma.itemAttachment.count({ where: { fileId: photo.fileId } }));
    if (!used) {
      await prisma.file.delete({ where: { id: photo.fileId } });
      await removeStoredFile(env, photo.file.storageKey);
    }
    return ok(null, 'Foto dihapus');
  });
}
