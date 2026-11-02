import type { FastifyInstance } from 'fastify';
import { Prisma } from '@prisma/client';
import { ROLE_CODES, goodsReceiptSchema, procurementSchema, uuid, type ProcurementInput } from '@sima/shared';
import { prisma } from '../../lib/prisma';
import { ok, paginated } from '../../lib/respond';
import { conflict, forbidden, notFound, unprocessable } from '../../lib/errors';
import { writeAudit } from '../../lib/audit';
import { assertStatus, lockRows } from '../../lib/doc';
import { nextDocNumber } from '../../lib/sequence';
import { parseListQuery } from '../../lib/list';
import { currentUser, requirePermission } from '../../plugins/auth';
import { approvalTimeline, cancelPendingApproval, registerApprovalHandler, submitForApproval } from '../approvals/service';
import { notify, usersWithPermission } from '../notifications/service';
import { createAssetUnits } from '../assets/service';
import { postStockTransaction } from '../stocks/service';

type Tx = Prisma.TransactionClient;
const D = Prisma.Decimal;
const EDITABLE = ['DRAFT', 'REJECTED'] as const;

const listInclude = { vendor: { select: { id: true, name: true } }, _count: { select: { details: true } } } satisfies Prisma.ProcurementInclude;
const detailInclude = {
  vendor: true, fundingSource: true,
  details: { include: { item: { select: { id: true, code: true, name: true, type: true, unitOfMeasure: { select: { name: true } } } } }, orderBy: { item: { name: 'asc' } } },
  receipts: { select: { id: true, number: true, status: true, receivedDate: true }, orderBy: { createdAt: 'desc' } },
} satisfies Prisma.ProcurementInclude;

async function validateLines(input: ProcurementInput) {
  const items = await prisma.item.findMany({ where: { id: { in: input.lines.map((l) => l.itemId) } } });
  const byId = new Map(items.map((i) => [i.id, i]));
  const errors: { field: string; message: string }[] = [];
  input.lines.forEach((l, i) => {
    const item = byId.get(l.itemId);
    if (!item) errors.push({ field: `lines.${i}.itemId`, message: 'Barang tidak ditemukan' });
    else if (!item.isActive) errors.push({ field: `lines.${i}.itemId`, message: `${item.name} sudah diarsipkan` });
    else if (item.type === 'ASSET' && !Number.isInteger(l.quantity)) errors.push({ field: `lines.${i}.quantity`, message: 'Jumlah barang inventaris harus bilangan bulat' });
  });
  const [vendor, funding] = await Promise.all([
    prisma.vendor.findUnique({ where: { id: input.vendorId } }),
    input.fundingSourceId ? prisma.fundingSource.findUnique({ where: { id: input.fundingSourceId } }) : null,
  ]);
  if (!vendor?.isActive) errors.push({ field: 'vendorId', message: 'Vendor tidak valid atau nonaktif' });
  if (input.fundingSourceId && !funding?.isActive) errors.push({ field: 'fundingSourceId', message: 'Sumber dana tidak valid atau nonaktif' });
  if (errors.length) throw unprocessable('Data pengadaan tidak valid', errors);
}

const lineData = (l: ProcurementInput['lines'][number]) => ({ itemId: l.itemId, quantity: l.quantity, unitPrice: l.unitPrice, subtotal: new D(l.quantity).mul(l.unitPrice), notes: l.notes });
const totalOf = (lines: ProcurementInput['lines']) => lines.reduce((s, l) => s.plus(new D(l.quantity).mul(l.unitPrice)), new D(0));

registerApprovalHandler('PROCUREMENT', {
  creatorId: async (tx, id) => (await tx.procurement.findUnique({ where: { id }, select: { createdById: true } }))?.createdById ?? null,
  onApproved: async (tx, { entityId }) => { await tx.procurement.update({ where: { id: entityId }, data: { status: 'APPROVED', approvedAt: new Date() } }); },
  onRejected: async (tx, { entityId }) => { await tx.procurement.update({ where: { id: entityId }, data: { status: 'REJECTED' } }); },
});

export async function procurementRoutes(app: FastifyInstance) {
  const idOf = (req: { params: unknown }) => uuid().parse((req.params as { id: string }).id);

  app.get('/procurements', { preHandler: requirePermission('procurements.view') }, async (req) => {
    const q = parseListQuery(req.query, ['number', 'date', 'totalAmount', 'status', 'createdAt'], 'createdAt', 'desc');
    const f = req.query as Record<string, string | undefined>;
    const where: Prisma.ProcurementWhereInput = {
      ...(q.search ? { OR: [{ number: { contains: q.search, mode: 'insensitive' } }, { vendor: { name: { contains: q.search, mode: 'insensitive' } } }] } : {}),
      ...(f.status ? { status: f.status as never } : {}),
      ...(f.vendorId ? { vendorId: uuid().parse(f.vendorId) } : {}),
      ...(f.fiscalYear ? { fiscalYear: Number(f.fiscalYear) || undefined } : {}),
    };
    const [rows, total] = await Promise.all([prisma.procurement.findMany({ where, include: listInclude, orderBy: q.orderBy, skip: q.skip, take: q.take }), prisma.procurement.count({ where })]);
    return paginated(rows.map(({ _count, ...r }) => ({ ...r, lineCount: _count.details })), total, q.page, q.limit);
  });

  app.post('/procurements', { preHandler: requirePermission('procurements.create') }, async (req, reply) => {
    const input = procurementSchema.parse(req.body);
    await validateLines(input);
    const created = await prisma.$transaction(async (tx) => {
      const number = await nextDocNumber(tx, 'PGD', new Date(input.date));
      const p = await tx.procurement.create({
        data: { number, date: new Date(input.date), fiscalYear: input.fiscalYear, vendorId: input.vendorId, fundingSourceId: input.fundingSourceId, notes: input.notes, totalAmount: totalOf(input.lines), createdById: currentUser(req).user.id, details: { create: input.lines.map(lineData) } },
        include: detailInclude,
      });
      await writeAudit(tx, req, { action: 'CREATE', entityType: 'Procurement', entityId: p.id, after: { number, totalAmount: p.totalAmount.toString(), lines: p.details.length } });
      return p;
    });
    return reply.code(201).send(ok(created, `Pengadaan ${created.number} dibuat sebagai draft`));
  });

  app.get('/procurements/:id', { preHandler: requirePermission('procurements.view') }, async (req) => {
    const id = idOf(req);
    const p = await prisma.procurement.findUnique({ where: { id }, include: detailInclude });
    if (!p) throw notFound('Pengadaan tidak ditemukan');
    const creator = await prisma.user.findUnique({ where: { id: p.createdById }, select: { name: true } });
    return ok({ ...p, createdByName: creator?.name ?? '-', approval: await approvalTimeline('PROCUREMENT', id) });
  });

  // Hanya draft atau yang ditolak yang boleh diedit; dokumen disetujui tidak boleh diubah langsung.
  app.patch('/procurements/:id', { preHandler: requirePermission('procurements.update') }, async (req) => {
    const id = idOf(req);
    const input = procurementSchema.parse(req.body);
    await validateLines(input);
    const updated = await prisma.$transaction(async (tx) => {
      await lockRows(tx, 'procurements', [id]);
      const before = await tx.procurement.findUnique({ where: { id }, include: { details: true } });
      if (!before) throw notFound('Pengadaan tidak ditemukan');
      assertStatus(before.status, EDITABLE, 'Pengadaan yang sudah diajukan atau disetujui tidak dapat diedit langsung');
      await tx.procurementDetail.deleteMany({ where: { procurementId: id } });
      const p = await tx.procurement.update({
        where: { id },
        data: { date: new Date(input.date), fiscalYear: input.fiscalYear, vendorId: input.vendorId, fundingSourceId: input.fundingSourceId, notes: input.notes, totalAmount: totalOf(input.lines), status: 'DRAFT', details: { create: input.lines.map(lineData) } },
        include: detailInclude,
      });
      await writeAudit(tx, req, { action: 'UPDATE', entityType: 'Procurement', entityId: id, before: { totalAmount: before.totalAmount.toString(), lines: before.details.length }, after: { totalAmount: p.totalAmount.toString(), lines: p.details.length } });
      return p;
    });
    return ok(updated, 'Pengadaan diperbarui');
  });

  app.post('/procurements/:id/submit', { preHandler: requirePermission('procurements.submit') }, async (req) => {
    const id = idOf(req);
    const auth = currentUser(req);
    await prisma.$transaction(async (tx) => {
      await lockRows(tx, 'procurements', [id]);
      const p = await tx.procurement.findUnique({ where: { id }, include: { vendor: true, _count: { select: { details: true } } } });
      if (!p) throw notFound('Pengadaan tidak ditemukan');
      assertStatus(p.status, EDITABLE, 'Hanya draft atau pengadaan yang ditolak yang dapat diajukan');
      if (!p._count.details) throw unprocessable('Pengadaan belum memiliki barang');
      await tx.procurement.update({ where: { id }, data: { status: 'PENDING_APPROVAL', submittedAt: new Date() } });
      await submitForApproval(tx, req, { entityType: 'PROCUREMENT', entityId: id, documentNumber: p.number, title: `Pengadaan ${p.number} dari ${p.vendor.name}, total Rp ${p.totalAmount.toString()}`, requestedById: auth.user.id });
      await writeAudit(tx, req, { action: 'STATUS_CHANGE', entityType: 'Procurement', entityId: id, before: { status: p.status }, after: { status: 'PENDING_APPROVAL' } });
    });
    return ok(null, 'Pengadaan diajukan untuk persetujuan');
  });

  app.post('/procurements/:id/cancel', { preHandler: requirePermission('procurements.update') }, async (req) => {
    const id = idOf(req);
    await prisma.$transaction(async (tx) => {
      await lockRows(tx, 'procurements', [id]);
      const p = await tx.procurement.findUnique({ where: { id } });
      if (!p) throw notFound('Pengadaan tidak ditemukan');
      assertStatus(p.status, EDITABLE, 'Hanya draft atau pengadaan yang ditolak yang dapat dibatalkan');
      await tx.procurement.update({ where: { id }, data: { status: 'CANCELLED' } });
      await cancelPendingApproval(tx, 'PROCUREMENT', id);
      await writeAudit(tx, req, { action: 'STATUS_CHANGE', entityType: 'Procurement', entityId: id, before: { status: p.status }, after: { status: 'CANCELLED' } });
    });
    return ok(null, 'Pengadaan dibatalkan');
  });

  // ------------------------------------------------------------ penerimaan barang
  app.post('/procurements/:id/receive', { preHandler: requirePermission('goods_receipts.create') }, async (req, reply) => {
    const id = idOf(req);
    const input = goodsReceiptSchema.parse(req.body);
    const p = await prisma.procurement.findUnique({ where: { id }, include: { details: { include: { item: true } } } });
    if (!p) throw notFound('Pengadaan tidak ditemukan');
    assertStatus(p.status, ['APPROVED', 'PARTIALLY_RECEIVED'] as const, 'Barang hanya dapat diterima dari pengadaan yang sudah disetujui');

    const errors: { field: string; message: string }[] = [];
    let needsAsset = false, needsSupply = false;
    input.lines.forEach((l, i) => {
      const d = p.details.find((x) => x.id === l.procurementDetailId);
      if (!d) return void errors.push({ field: `lines.${i}.procurementDetailId`, message: 'Baris tidak termasuk dalam pengadaan ini' });
      const remaining = d.quantity.minus(d.receivedQty);
      if (new D(l.quantityReceived).gt(remaining)) errors.push({ field: `lines.${i}.quantityReceived`, message: `Melebihi sisa yang belum diterima (${remaining.toString()})` });
      if (d.item.type === 'ASSET') {
        needsAsset = true;
        if (!Number.isInteger(l.quantityReceived)) errors.push({ field: `lines.${i}.quantityReceived`, message: 'Jumlah barang inventaris harus bilangan bulat' });
        const serials = l.serialNumbers.map((s) => s.trim());
        if (serials.length && serials.length !== l.quantityReceived) errors.push({ field: `lines.${i}.serialNumbers`, message: `Isi ${l.quantityReceived} nomor seri atau kosongkan` });
        const filled = serials.filter(Boolean).map((s) => s.toLowerCase());
        if (new Set(filled).size !== filled.length) errors.push({ field: `lines.${i}.serialNumbers`, message: 'Ada nomor seri yang sama' });
      } else needsSupply = true;
    });
    if (needsAsset) {
      const [unit, loc] = await Promise.all([input.assetUnitId ? prisma.organizationalUnit.findUnique({ where: { id: input.assetUnitId } }) : null, input.assetLocationId ? prisma.location.findUnique({ where: { id: input.assetLocationId } }) : null]);
      if (!unit?.isActive) errors.push({ field: 'assetUnitId', message: 'Unit pengelola wajib dipilih untuk barang inventaris' });
      if (!loc?.isActive) errors.push({ field: 'assetLocationId', message: 'Lokasi wajib dipilih untuk barang inventaris' });
    }
    if (needsSupply) {
      const wh = input.warehouseId ? await prisma.warehouse.findUnique({ where: { id: input.warehouseId } }) : null;
      if (!wh?.isActive) errors.push({ field: 'warehouseId', message: 'Gudang wajib dipilih untuk barang persediaan' });
    }
    if (errors.length) throw unprocessable('Data penerimaan tidak valid', errors);

    const receipt = await prisma.$transaction(async (tx) => {
      const number = await nextDocNumber(tx, 'TRM', new Date(input.receivedDate));
      const r = await tx.goodsReceipt.create({
        data: {
          number, procurementId: id, receivedDate: new Date(input.receivedDate), warehouseId: input.warehouseId, assetUnitId: input.assetUnitId, assetLocationId: input.assetLocationId,
          assetPersonId: input.assetPersonId, notes: input.notes, receivedById: currentUser(req).user.id,
          details: { create: input.lines.map((l) => ({ procurementDetailId: l.procurementDetailId, itemId: p.details.find((d) => d.id === l.procurementDetailId)!.itemId, quantityReceived: l.quantityReceived, serialNumbers: l.serialNumbers.map((s) => s.trim()).filter(Boolean).length ? l.serialNumbers.map((s) => s.trim()) : [] })) },
        },
        include: { details: true },
      });
      await writeAudit(tx, req, { action: 'CREATE', entityType: 'GoodsReceipt', entityId: r.id, after: { number, procurementId: id, lines: r.details.length } });
      const verifiers = await usersWithPermission(tx, 'goods_receipts.confirm', { excludeUserId: currentUser(req).user.id });
      await notify(tx, verifiers, { type: 'receipt.pending', title: `Penerimaan ${number} menunggu verifikasi`, body: `Dari pengadaan ${p.number}`, entityType: 'GOODS_RECEIPT', entityId: r.id });
      return r;
    });
    return reply.code(201).send(ok(receipt, `Penerimaan ${receipt.number} dicatat, menunggu konfirmasi`));
  });

  const receiptInclude = { procurement: { select: { id: true, number: true, vendor: { select: { name: true } } } }, warehouse: { select: { name: true } }, details: { include: { item: { select: { code: true, name: true, type: true } } } } } satisfies Prisma.GoodsReceiptInclude;

  app.get('/goods-receipts', { preHandler: requirePermission('goods_receipts.view') }, async (req) => {
    const q = parseListQuery(req.query, ['number', 'receivedDate', 'status', 'createdAt'], 'createdAt', 'desc');
    const f = req.query as Record<string, string | undefined>;
    const where: Prisma.GoodsReceiptWhereInput = {
      ...(q.search ? { OR: [{ number: { contains: q.search, mode: 'insensitive' } }, { procurement: { number: { contains: q.search, mode: 'insensitive' } } }] } : {}),
      ...(f.status ? { status: f.status as never } : {}), ...(f.procurementId ? { procurementId: uuid().parse(f.procurementId) } : {}),
    };
    const [rows, total] = await Promise.all([prisma.goodsReceipt.findMany({ where, include: receiptInclude, orderBy: q.orderBy, skip: q.skip, take: q.take }), prisma.goodsReceipt.count({ where })]);
    return paginated(rows, total, q.page, q.limit);
  });

  app.get('/goods-receipts/:id', { preHandler: requirePermission('goods_receipts.view') }, async (req) => {
    const r = await prisma.goodsReceipt.findUnique({ where: { id: idOf(req) }, include: receiptInclude });
    if (!r) throw notFound('Penerimaan tidak ditemukan');
    return ok(r);
  });

  app.post('/goods-receipts/:id/cancel', { preHandler: requirePermission('goods_receipts.create') }, async (req) => {
    const id = idOf(req);
    await prisma.$transaction(async (tx) => {
      await lockRows(tx, 'goods_receipts', [id]);
      const r = await tx.goodsReceipt.findUnique({ where: { id } });
      if (!r) throw notFound('Penerimaan tidak ditemukan');
      assertStatus(r.status, ['DRAFT'] as const, 'Hanya penerimaan yang belum dikonfirmasi yang dapat dibatalkan');
      await tx.goodsReceipt.update({ where: { id }, data: { status: 'CANCELLED' } });
      await writeAudit(tx, req, { action: 'STATUS_CHANGE', entityType: 'GoodsReceipt', entityId: id, before: { status: 'DRAFT' }, after: { status: 'CANCELLED' } });
    });
    return ok(null, 'Penerimaan dibatalkan');
  });

  // Inventaris/stok baru hanya lahir di sini, setelah penerimaan dikonfirmasi (semua atau tidak sama sekali).
  app.post('/goods-receipts/:id/confirm', { preHandler: requirePermission('goods_receipts.confirm') }, async (req) => {
    const id = idOf(req);
    const auth = currentUser(req);
    const result = await prisma.$transaction(async (tx: Tx) => {
      await lockRows(tx, 'goods_receipts', [id]);
      const r = await tx.goodsReceipt.findUnique({ where: { id }, include: { details: true, procurement: { include: { details: true } } } });
      if (!r) throw notFound('Penerimaan tidak ditemukan');
      assertStatus(r.status, ['DRAFT'] as const, 'Penerimaan ini sudah dikonfirmasi atau dibatalkan');
      if (r.receivedById === auth.user.id && !auth.roleCodes.has(ROLE_CODES.SUPER_ADMIN)) {
        throw forbidden('Verifikasi penerimaan harus dilakukan oleh petugas lain, bukan yang mencatatnya');
      }
      await lockRows(tx, 'procurements', [r.procurementId]);
      await lockRows(tx, 'procurement_details', r.details.map((d) => d.procurementDetailId));
      const procurement = await tx.procurement.findUniqueOrThrow({ where: { id: r.procurementId }, include: { details: true, vendor: true } });
      assertStatus(procurement.status, ['APPROVED', 'PARTIALLY_RECEIVED'] as const, 'Status pengadaan tidak lagi mengizinkan penerimaan');

      const createdAssets: string[] = [];
      for (const line of r.details) {
        const pd = procurement.details.find((x) => x.id === line.procurementDetailId)!;
        const remaining = pd.quantity.minus(pd.receivedQty);
        if (line.quantityReceived.gt(remaining)) throw unprocessable('Jumlah diterima melebihi sisa pengadaan', [{ field: 'lines', message: `Sisa yang belum diterima tinggal ${remaining.toString()}` }]);
        const item = await tx.item.findUniqueOrThrow({ where: { id: line.itemId }, include: { category: true } });
        if (item.type === 'ASSET') {
          const assets = await createAssetUnits(tx, req, {
            item, count: line.quantityReceived.toNumber(), serials: line.serialNumbers.map((s) => s || null), acquisitionDate: r.receivedDate, acquisitionYear: r.receivedDate.getFullYear(),
            fundingSourceId: procurement.fundingSourceId, vendorId: procurement.vendorId, acquisitionCost: pd.unitPrice.toString(), condition: 'GOOD',
            unitId: r.assetUnitId!, locationId: r.assetLocationId!, personId: r.assetPersonId, notes: null, userId: auth.user.id, goodsReceiptDetailId: line.id,
            note: `Penerimaan ${r.number} (pengadaan ${procurement.number})`,
          });
          createdAssets.push(...assets.map((a) => a.code));
        } else {
          await postStockTransaction(tx, req, {
            type: 'IN', date: r.receivedDate, warehouseId: r.warehouseId!, lines: [{ itemId: item.id, delta: line.quantityReceived.toString(), unitCost: pd.unitPrice.toNumber() }],
            sourceType: 'GOODS_RECEIPT', sourceId: r.id, notes: `Penerimaan ${r.number} (pengadaan ${procurement.number})`, userId: auth.user.id,
          });
        }
        await tx.procurementDetail.update({ where: { id: pd.id }, data: { receivedQty: pd.receivedQty.plus(line.quantityReceived) } });
      }

      const fresh = await tx.procurementDetail.findMany({ where: { procurementId: procurement.id } });
      const complete = fresh.every((d) => d.receivedQty.gte(d.quantity));
      await tx.procurement.update({ where: { id: procurement.id }, data: { status: complete ? 'COMPLETED' : 'PARTIALLY_RECEIVED', completedAt: complete ? new Date() : null } });
      await tx.goodsReceipt.update({ where: { id }, data: { status: 'CONFIRMED', confirmedAt: new Date(), confirmedById: auth.user.id } });
      await writeAudit(tx, req, { action: 'RECEIPT_CONFIRM', entityType: 'GoodsReceipt', entityId: id, after: { number: r.number, procurement: procurement.number, assets: createdAssets, procurementStatus: complete ? 'COMPLETED' : 'PARTIALLY_RECEIVED' } });
      await notify(tx, [r.receivedById, procurement.createdById].filter((u) => u !== auth.user.id), { type: 'receipt.confirmed', title: `Penerimaan ${r.number} dikonfirmasi`, body: createdAssets.length ? `${createdAssets.length} unit aset terdaftar` : 'Stok bertambah', entityType: 'PROCUREMENT', entityId: procurement.id });
      return { assets: createdAssets, completed: complete };
    });
    return ok(result, result.completed ? 'Penerimaan dikonfirmasi, pengadaan selesai' : 'Penerimaan dikonfirmasi');
  });
}
