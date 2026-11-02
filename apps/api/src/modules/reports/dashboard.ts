import type { Prisma } from '@prisma/client';
import { APPROVAL_ENTITY_LABEL, approvalEntityPath, type ApprovalEntityType } from '@sima/shared';
import { prisma } from '../../lib/prisma';
import { unitScope } from '../../lib/scope';
import type { AuthContext } from '../../plugins/auth';
import { isEligible } from '../approvals/service';

const ACTION_LABEL: Record<string, string> = {
  CREATE: 'membuat', UPDATE: 'mengubah', ARCHIVE: 'mengarsipkan', STATUS_CHANGE: 'mengubah status', APPROVE: 'menyetujui', REJECT: 'menolak', APPROVAL_SUBMIT: 'mengajukan',
  RECEIPT_CONFIRM: 'mengonfirmasi penerimaan', MUTATION_COMPLETE: 'menyelesaikan mutasi', LOAN_HANDOVER: 'menyerahkan peminjaman', LOAN_RETURN: 'memproses pengembalian',
  MAINTENANCE_START: 'memulai perbaikan', MAINTENANCE_COMPLETE: 'menyelesaikan perbaikan', DISPOSAL_COMPLETE: 'memfinalisasi penghapusan', OPNAME_START: 'memulai pemeriksaan',
  OPNAME_SUBMIT: 'mengajukan hasil pemeriksaan', OPNAME_VERIFY: 'memverifikasi pemeriksaan', EXPORT: 'mengekspor', LOGIN: 'masuk ke aplikasi', LOGOUT: 'keluar dari aplikasi',
  STOCK_IN: 'mencatat barang masuk', STOCK_OUT: 'mencatat barang keluar', STOCK_OPENING: 'mencatat saldo awal', STOCK_ADJUSTMENT: 'memposting penyesuaian stok', PRINT_QR: 'mencetak QR',
};
export const ENTITY_LABEL: Record<string, string> = {
  Asset: 'aset', Item: 'master barang', Procurement: 'pengadaan', GoodsReceipt: 'penerimaan', AssetMutation: 'mutasi', Loan: 'peminjaman', Maintenance: 'pemeliharaan',
  PROCUREMENT: 'pengadaan', MUTATION: 'mutasi', LOAN: 'peminjaman', MAINTENANCE: 'pemeliharaan', STOCK_ADJUSTMENT: 'penyesuaian stok', DISPOSAL: 'penghapusan',
  Disposal: 'penghapusan', StockOpname: 'stock opname', StockAdjustment: 'penyesuaian stok', StockTransaction: 'transaksi stok', User: 'pengguna', Role: 'role', Report: 'laporan',
};
export const describeAudit = (action: string, entityType: string, after: unknown) => {
  const a = after as { number?: string; documentNumber?: string; code?: string } | null;
  const number = a?.number ?? a?.documentNumber ?? a?.code;
  return `${ACTION_LABEL[action] ?? action.toLowerCase()} ${ENTITY_LABEL[entityType] ?? entityType.toLowerCase()}${number ? ` ${number}` : ''}`;
};

export async function dashboardData(auth: AuthContext) {
  const scope = unitScope(auth);
  const live: Prisma.AssetWhereInput = { ...scope, archivedAt: null, status: { not: 'DISPOSED' } };
  const [total, cost, byCondition, byStatus, byCategoryRaw, byLocationRaw, supplyItems, supplyQty, lowStockRows, pendingRows, recent, procurements] = await Promise.all([
    prisma.asset.count({ where: live }),
    prisma.asset.aggregate({ where: live, _sum: { acquisitionCost: true } }),
    prisma.asset.groupBy({ by: ['condition'], where: { ...live, status: { notIn: ['DISPOSED', 'MISSING'] } }, _count: true }),
    prisma.asset.groupBy({ by: ['status'], where: live, _count: true }),
    prisma.asset.findMany({ where: live, select: { item: { select: { category: { select: { name: true } } } } } }),
    prisma.asset.groupBy({ by: ['locationId'], where: live, _count: true, orderBy: { _count: { locationId: 'desc' } }, take: 8 }),
    prisma.item.count({ where: { type: 'SUPPLY', isActive: true } }),
    prisma.stockBalance.aggregate({ _sum: { quantity: true } }),
    prisma.$queryRaw<{ id: string }[]>`
      SELECT i.id FROM items i LEFT JOIN stock_balances b ON b."itemId" = i.id
      WHERE i.type = 'SUPPLY' AND i."isActive" AND i."minStock" > 0
      GROUP BY i.id HAVING COALESCE(SUM(b.quantity), 0) < i."minStock"`,
    prisma.approvalRequest.findMany({ where: { status: 'PENDING' }, include: { steps: { include: { role: true } } }, orderBy: { submittedAt: 'asc' } }),
    prisma.auditLog.findMany({ orderBy: { createdAt: 'desc' }, take: 10, where: { action: { notIn: ['LOGIN', 'LOGOUT'] } } }),
    prisma.procurement.findMany({ where: { status: { in: ['APPROVED', 'PARTIALLY_RECEIVED', 'COMPLETED'] }, date: { gte: new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth() - 11, 1)) } }, select: { date: true, totalAmount: true } }),
  ]);

  const count = (m: { status?: string; condition?: string; _count: number }[], k: 'status' | 'condition', v: string) => (m as any[]).find((x) => x[k] === v)?._count ?? 0;
  const catMap = new Map<string, number>();
  byCategoryRaw.forEach((a) => catMap.set(a.item.category.name, (catMap.get(a.item.category.name) ?? 0) + 1));
  const locs = await prisma.location.findMany({ where: { id: { in: byLocationRaw.map((l) => l.locationId) } }, select: { id: true, name: true } });
  const locName = new Map(locs.map((l) => [l.id, l.name]));

  const now = new Date();
  const months = Array.from({ length: 12 }, (_, i) => { const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 11 + i, 1)); return { key: d.toISOString().slice(0, 7), label: d.toLocaleDateString('id-ID', { month: 'short', year: '2-digit', timeZone: 'UTC' }), total: 0 }; });
  procurements.forEach((p) => { const m = months.find((x) => x.key === p.date.toISOString().slice(0, 7)); if (m) m.total += p.totalAmount.toNumber(); });

  const mine = pendingRows.filter((r) => r.requestedById !== auth.user.id && isEligible(auth, r.entityType as ApprovalEntityType, r.steps.find((s) => s.stepOrder === r.currentStep)?.role.code ?? ''));
  const users = await prisma.user.findMany({ where: { id: { in: [...new Set([...recent.map((r) => r.userId), ...mine.slice(0, 5).map((r) => r.requestedById)].filter(Boolean) as string[])] } }, select: { id: true, name: true } });
  const uname = new Map(users.map((u) => [u.id, u.name]));

  return {
    stats: {
      totalAssets: total, acquisitionValue: cost._sum.acquisitionCost?.toNumber() ?? 0, supplyItems, supplyQuantity: supplyQty._sum.quantity?.toNumber() ?? 0,
      good: count(byCondition as never, 'condition', 'GOOD'), minorDamage: count(byCondition as never, 'condition', 'MINOR_DAMAGE'), majorDamage: count(byCondition as never, 'condition', 'MAJOR_DAMAGE'),
      missing: count(byStatus as never, 'status', 'MISSING'), loaned: count(byStatus as never, 'status', 'LOANED'), underMaintenance: count(byStatus as never, 'status', 'UNDER_MAINTENANCE'),
      lowStock: lowStockRows.length, pendingApprovals: pendingRows.length, pendingForMe: mine.length,
    },
    charts: {
      byCategory: [...catMap.entries()].map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value).slice(0, 10),
      byCondition: [{ key: 'GOOD', name: 'Baik' }, { key: 'MINOR_DAMAGE', name: 'Rusak ringan' }, { key: 'MAJOR_DAMAGE', name: 'Rusak berat' }].map((c) => ({ ...c, value: count(byCondition as never, 'condition', c.key) })),
      byLocation: byLocationRaw.map((l) => ({ name: locName.get(l.locationId) ?? '-', value: l._count })),
      procurementPerMonth: months.map(({ label, total }) => ({ label, total })),
    },
    pendingApprovals: mine.slice(0, 5).map((r) => ({ id: r.id, entityLabel: APPROVAL_ENTITY_LABEL[r.entityType as ApprovalEntityType], documentNumber: r.documentNumber, title: r.title, requestedBy: uname.get(r.requestedById) ?? '-', submittedAt: r.submittedAt, path: approvalEntityPath(r.entityType as ApprovalEntityType, r.entityId) })),
    recentActivity: recent.map((r) => ({ id: r.id, at: r.createdAt, user: r.userId ? uname.get(r.userId) ?? 'Sistem' : 'Sistem', text: describeAudit(r.action, r.entityType, r.after) })),
  };
}
