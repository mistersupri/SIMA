import type { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { todayDate } from '../../lib/doc';
import { notify, usersWithPermission } from '../notifications/service';

/**
 * Tandai pinjaman yang lewat jatuh tempo sebagai OVERDUE dan kirim pengingat.
 * Idempoten: notifikasi memakai dedupeKey sehingga aman dijalankan berulang.
 */
export async function sweepLoans(now = new Date()) {
  const today = new Date(now.toISOString().slice(0, 10));
  const tomorrow = new Date(today.getTime() + 86400000);
  return prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const overdue = await tx.loan.findMany({ where: { status: { in: ['ACTIVE', 'OVERDUE'] }, expectedReturnDate: { lt: today } }, include: { borrower: { select: { name: true } } } });
    const dueSoon = await tx.loan.findMany({ where: { status: 'ACTIVE', expectedReturnDate: { gte: today, lt: new Date(tomorrow.getTime() + 86400000) } } });
    const staff = await usersWithPermission(tx, 'loans.return');
    for (const l of overdue) {
      if (l.status === 'ACTIVE') await tx.loan.update({ where: { id: l.id }, data: { status: 'OVERDUE' } });
      await notify(tx, [...new Set([l.createdById, ...staff])], { type: 'loan.overdue', title: `Peminjaman ${l.number} terlambat`, body: `Peminjam ${l.borrower.name}, jatuh tempo ${l.expectedReturnDate.toISOString().slice(0, 10)}`, entityType: 'LOAN', entityId: l.id, dedupeKey: `loan-overdue:${l.id}` });
    }
    for (const l of dueSoon) {
      await notify(tx, [...new Set([l.createdById, ...staff])], { type: 'loan.due_soon', title: `Peminjaman ${l.number} segera jatuh tempo`, body: `Rencana kembali ${l.expectedReturnDate.toISOString().slice(0, 10)}`, entityType: 'LOAN', entityId: l.id, dedupeKey: `loan-due:${l.id}` });
    }
    return { overdue: overdue.length, dueSoon: dueSoon.length, today: todayDate() };
  });
}
