import type { FastifyInstance } from 'fastify';
import { Prisma } from '@prisma/client';
import { loanReturnSchema, loanSchema, uuid } from '@sima/shared';
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

/** Lepaskan "kunci" pinjaman: aset boleh dipinjam pihak lain lagi. */
const release = (tx: Tx, loanId: string) => tx.loanDetail.updateMany({ where: { loanId, returnedAt: null }, data: { isOpen: false } });

registerApprovalHandler('LOAN', {
  creatorId: async (tx, id) => (await tx.loan.findUnique({ where: { id }, select: { createdById: true } }))?.createdById ?? null,
  onApproved: async (tx, { entityId }) => { await tx.loan.update({ where: { id: entityId }, data: { status: 'APPROVED', approvedAt: new Date() } }); },
  onRejected: async (tx, { entityId }) => { await tx.loan.update({ where: { id: entityId }, data: { status: 'REJECTED' } }); await release(tx, entityId); },
});

async function checkAssets(tx: Tx | typeof prisma, assetIds: string[]) {
  const assets = await tx.asset.findMany({ where: { id: { in: assetIds } } });
  const errors: { field: string; message: string }[] = [];
  const STATUS_MSG: Record<string, string> = { LOANED: 'sedang dipinjam', UNDER_MAINTENANCE: 'sedang dalam perbaikan', DISPOSED: 'sudah dihapuskan', MISSING: 'berstatus tidak ditemukan' };
  assetIds.forEach((id, i) => {
    const a = assets.find((x) => x.id === id);
    if (!a) errors.push({ field: `assetIds.${i}`, message: 'Aset tidak ditemukan' });
    else if (a.status !== 'AVAILABLE') errors.push({ field: `assetIds.${i}`, message: `${a.code} ${STATUS_MSG[a.status] ?? a.status} dan tidak dapat dipinjam` });
    else if (a.archivedAt) errors.push({ field: `assetIds.${i}`, message: `${a.code} sudah diarsipkan` });
  });
  if (errors.length) throw unprocessable('Aset tidak dapat dipinjam', errors);
  return assets;
}

const display = <T extends { status: string; expectedReturnDate: Date }>(l: T) =>
  ({ ...l, displayStatus: l.status === 'ACTIVE' && l.expectedReturnDate < new Date(new Date().toISOString().slice(0, 10)) ? 'OVERDUE' : l.status });

export async function loanRoutes(app: FastifyInstance) {
  const idOf = (req: { params: unknown }) => uuid().parse((req.params as { id: string }).id);
  const include = { borrower: { select: { id: true, name: true } }, _count: { select: { details: true } } } satisfies Prisma.LoanInclude;

  app.get('/loans', { preHandler: requirePermission('loans.view') }, async (req) => {
    const q = parseListQuery(req.query, ['number', 'loanDate', 'expectedReturnDate', 'status', 'createdAt'], 'createdAt', 'desc');
    const f = req.query as Record<string, string | undefined>;
    const where: Prisma.LoanWhereInput = {
      ...(q.search ? { OR: [{ number: { contains: q.search, mode: 'insensitive' } }, { borrower: { name: { contains: q.search, mode: 'insensitive' } } }, { details: { some: { asset: { code: { contains: q.search, mode: 'insensitive' } } } } }] } : {}),
      ...(f.status ? { status: f.status as never } : {}), ...(f.borrowerPersonId ? { borrowerPersonId: uuid().parse(f.borrowerPersonId) } : {}),
    };
    const [rows, total] = await Promise.all([prisma.loan.findMany({ where, include, orderBy: q.orderBy, skip: q.skip, take: q.take }), prisma.loan.count({ where })]);
    return paginated(rows.map(({ _count, ...r }) => ({ ...display(r), assetCount: _count.details })), total, q.page, q.limit);
  });

  app.post('/loans', { preHandler: requirePermission('loans.create') }, async (req, reply) => {
    const input = loanSchema.parse(req.body);
    const auth = currentUser(req);
    const [borrower, assets] = await Promise.all([prisma.person.findUnique({ where: { id: input.borrowerPersonId } }), checkAssets(prisma, input.assetIds)]);
    if (!borrower?.isActive) throw unprocessable('Peminjam tidak valid', [{ field: 'borrowerPersonId', message: 'Peminjam tidak valid atau nonaktif' }]);
    assets.forEach((a) => assertUnitAccess(auth, a.unitId));
    const created = await prisma.$transaction(async (tx) => {
      const number = await nextDocNumber(tx, 'PJM', new Date(input.loanDate));
      // Draft belum mengunci aset (isOpen=false); kunci dipasang saat diajukan.
      const l = await tx.loan.create({
        data: { number, borrowerPersonId: input.borrowerPersonId, unitId: input.unitId, loanDate: new Date(input.loanDate), expectedReturnDate: new Date(input.expectedReturnDate), purpose: input.purpose, createdById: auth.user.id, details: { create: assets.map((a) => ({ assetId: a.id, conditionBefore: a.condition, isOpen: false })) } },
        include: { details: true },
      });
      await writeAudit(tx, req, { action: 'CREATE', entityType: 'Loan', entityId: l.id, after: { number, borrower: borrower.name, assets: assets.map((a) => a.code) } });
      return l;
    });
    return reply.code(201).send(ok(created, `Peminjaman ${created.number} dibuat sebagai draft`));
  });

  app.get('/loans/:id', { preHandler: requirePermission('loans.view') }, async (req) => {
    const id = idOf(req);
    const l = await prisma.loan.findUnique({ where: { id }, include: { borrower: true, details: { include: { asset: { select: { id: true, code: true, status: true, condition: true, item: { select: { name: true } }, location: { select: { name: true } } } } } } } });
    if (!l) throw notFound('Peminjaman tidak ditemukan');
    const creator = await prisma.user.findUnique({ where: { id: l.createdById }, select: { name: true } });
    return ok({ ...display(l), createdByName: creator?.name ?? '-', approval: await approvalTimeline('LOAN', id) });
  });

  app.patch('/loans/:id', { preHandler: requirePermission('loans.create') }, async (req) => {
    const id = idOf(req);
    const input = loanSchema.parse(req.body);
    const assets = await checkAssets(prisma, input.assetIds);
    const updated = await prisma.$transaction(async (tx) => {
      await lockRows(tx, 'loans', [id]);
      const before = await tx.loan.findUnique({ where: { id } });
      if (!before) throw notFound('Peminjaman tidak ditemukan');
      assertStatus(before.status, EDITABLE, 'Peminjaman yang sudah diajukan atau disetujui tidak dapat diedit langsung');
      await tx.loanDetail.deleteMany({ where: { loanId: id } });
      const l = await tx.loan.update({
        where: { id },
        data: { borrowerPersonId: input.borrowerPersonId, unitId: input.unitId, loanDate: new Date(input.loanDate), expectedReturnDate: new Date(input.expectedReturnDate), purpose: input.purpose, status: 'DRAFT', details: { create: assets.map((a) => ({ assetId: a.id, conditionBefore: a.condition, isOpen: false })) } },
        include: { details: true },
      });
      await writeAudit(tx, req, { action: 'UPDATE', entityType: 'Loan', entityId: id, before: { purpose: before.purpose }, after: { purpose: l.purpose, assets: l.details.length } });
      return l;
    });
    return ok(updated, 'Peminjaman diperbarui');
  });

  app.post('/loans/:id/submit', { preHandler: requirePermission('loans.submit') }, async (req) => {
    const id = idOf(req);
    const auth = currentUser(req);
    await prisma.$transaction(async (tx) => {
      await lockRows(tx, 'loans', [id]);
      const l = await tx.loan.findUnique({ where: { id }, include: { details: true, borrower: true } });
      if (!l) throw notFound('Peminjaman tidak ditemukan');
      assertStatus(l.status, EDITABLE, 'Hanya draft atau peminjaman yang ditolak yang dapat diajukan');
      await lockRows(tx, 'assets', l.details.map((d) => d.assetId));
      await checkAssets(tx, l.details.map((d) => d.assetId));
      try {
        // Partial unique index (assetId WHERE isOpen) menolak aset yang sudah ada di pinjaman lain.
        await tx.loanDetail.updateMany({ where: { loanId: id }, data: { isOpen: true } });
      } catch (e) {
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') throw conflict('Salah satu aset sudah berada di peminjaman lain yang masih berjalan');
        throw e;
      }
      await tx.loan.update({ where: { id }, data: { status: 'PENDING_APPROVAL', submittedAt: new Date() } });
      await submitForApproval(tx, req, { entityType: 'LOAN', entityId: id, documentNumber: l.number, title: `Peminjaman ${l.number} oleh ${l.borrower.name}: ${l.purpose}`, requestedById: auth.user.id });
      await writeAudit(tx, req, { action: 'STATUS_CHANGE', entityType: 'Loan', entityId: id, before: { status: l.status }, after: { status: 'PENDING_APPROVAL' } });
    });
    return ok(null, 'Peminjaman diajukan untuk persetujuan');
  });

  app.post('/loans/:id/cancel', { preHandler: requirePermission('loans.create') }, async (req) => {
    const id = idOf(req);
    await prisma.$transaction(async (tx) => {
      await lockRows(tx, 'loans', [id]);
      const l = await tx.loan.findUnique({ where: { id } });
      if (!l) throw notFound('Peminjaman tidak ditemukan');
      assertStatus(l.status, ['DRAFT', 'REJECTED', 'APPROVED'] as const, 'Peminjaman ini tidak dapat dibatalkan pada status sekarang');
      await tx.loan.update({ where: { id }, data: { status: 'CANCELLED' } });
      await release(tx, id);
      await cancelPendingApproval(tx, 'LOAN', id);
      await writeAudit(tx, req, { action: 'STATUS_CHANGE', entityType: 'Loan', entityId: id, before: { status: l.status }, after: { status: 'CANCELLED' } });
    });
    return ok(null, 'Peminjaman dibatalkan');
  });

  // Serah terima: aset benar-benar berstatus DIPINJAM mulai di sini.
  app.post('/loans/:id/handover', { preHandler: requirePermission('loans.handover') }, async (req) => {
    const id = idOf(req);
    const auth = currentUser(req);
    await prisma.$transaction(async (tx) => {
      await lockRows(tx, 'loans', [id]);
      const l = await tx.loan.findUnique({ where: { id }, include: { details: true } });
      if (!l) throw notFound('Peminjaman tidak ditemukan');
      assertStatus(l.status, ['APPROVED'] as const, 'Serah terima hanya dapat dilakukan setelah peminjaman disetujui');
      await lockRows(tx, 'assets', l.details.map((d) => d.assetId));
      for (const d of l.details) {
        const a = await tx.asset.findUniqueOrThrow({ where: { id: d.assetId } });
        if (a.status !== 'AVAILABLE') throw conflict(`${a.code} tidak tersedia (status ${a.status}), serah terima dibatalkan`);
        await tx.asset.update({ where: { id: a.id }, data: { status: 'LOANED' } });
        await tx.assetConditionHistory.create({ data: { assetId: a.id, fromCondition: a.condition, toCondition: a.condition, fromStatus: 'AVAILABLE', toStatus: 'LOANED', sourceType: 'LOAN', sourceId: id, note: `Peminjaman ${l.number}`, changedById: auth.user.id } });
      }
      await tx.loan.update({ where: { id }, data: { status: 'ACTIVE', handedOverAt: new Date() } });
      await writeAudit(tx, req, { action: 'LOAN_HANDOVER', entityType: 'Loan', entityId: id, after: { number: l.number, assets: l.details.length } });
    });
    return ok(null, 'Serah terima dicatat, aset berstatus dipinjam');
  });

  app.post('/loans/:id/return', { preHandler: requirePermission('loans.return') }, async (req) => {
    const id = idOf(req);
    const auth = currentUser(req);
    const input = loanReturnSchema.parse(req.body);
    const result = await prisma.$transaction(async (tx) => {
      await lockRows(tx, 'loans', [id]);
      const l = await tx.loan.findUnique({ where: { id }, include: { details: true } });
      if (!l) throw notFound('Peminjaman tidak ditemukan');
      assertStatus(l.status, ['ACTIVE', 'OVERDUE'] as const, 'Pengembalian hanya untuk peminjaman yang sedang berjalan');
      await lockRows(tx, 'assets', l.details.map((d) => d.assetId));
      for (const r of input.returns) {
        const d = l.details.find((x) => x.assetId === r.assetId);
        if (!d) throw unprocessable('Aset tidak termasuk dalam peminjaman ini', [{ field: 'returns', message: 'Ada aset yang bukan bagian dari peminjaman ini' }]);
        if (d.returnedAt) throw unprocessable('Aset sudah dikembalikan', [{ field: 'returns', message: 'Ada aset yang sudah dikembalikan sebelumnya' }]);
        const a = await tx.asset.findUniqueOrThrow({ where: { id: r.assetId } });
        await tx.loanDetail.update({ where: { id: d.id }, data: { returnedAt: new Date(), isOpen: false, conditionAfter: r.conditionAfter, returnNotes: r.notes } });
        await tx.asset.update({ where: { id: a.id }, data: { status: 'AVAILABLE', condition: r.conditionAfter } });
        await tx.assetConditionHistory.create({ data: { assetId: a.id, fromCondition: a.condition, toCondition: r.conditionAfter, fromStatus: 'LOANED', toStatus: 'AVAILABLE', sourceType: 'RETURN', sourceId: id, note: r.notes ?? `Pengembalian ${l.number}`, changedById: auth.user.id } });
      }
      const open = await tx.loanDetail.count({ where: { loanId: id, returnedAt: null } });
      if (open === 0) await tx.loan.update({ where: { id }, data: { status: 'RETURNED', returnedAt: new Date() } });
      await writeAudit(tx, req, { action: 'LOAN_RETURN', entityType: 'Loan', entityId: id, after: { number: l.number, returned: input.returns.map((r) => ({ assetId: r.assetId, condition: r.conditionAfter })), remaining: open } });
      if (open === 0) await notify(tx, [l.createdById].filter((u) => u !== auth.user.id), { type: 'loan.returned', title: `Peminjaman ${l.number} dikembalikan`, entityType: 'LOAN', entityId: id });
      return { remaining: open };
    });
    return ok(result, result.remaining === 0 ? 'Semua aset dikembalikan, peminjaman selesai' : `Pengembalian sebagian dicatat, ${result.remaining} aset belum kembali`);
  });

  // Pemicu manual untuk sweep keterlambatan (juga berjalan terjadwal di server).
  app.post('/loans/sweep', { preHandler: requirePermission('loans.return') }, async () => {
    const { sweepLoans } = await import('./service');
    const r = await sweepLoans();
    return ok({ overdue: r.overdue, dueSoon: r.dueSoon }, 'Pemeriksaan keterlambatan selesai');
  });
}
