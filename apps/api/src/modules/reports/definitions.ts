import type { Prisma } from '@prisma/client';
import { ASSET_CONDITION_LABEL, ASSET_STATUS_LABEL, DISPOSAL_METHOD_LABEL, DOC_STATUS_LABEL, LOAN_STATUS_LABEL, MAINTENANCE_STATUS_LABEL, MAINTENANCE_TYPE_LABEL, MUTATION_STATUS_LABEL, OPNAME_STATUS_LABEL, PROCUREMENT_STATUS_LABEL } from '@sima/shared';
import { prisma } from '../../lib/prisma';
import { unitScope } from '../../lib/scope';
import type { AuthContext } from '../../plugins/auth';
import { locationTreeIds } from '../opnames/routes';

export type ColType = 'text' | 'number' | 'money' | 'date';
export interface Col { key: string; header: string; type?: ColType; width?: number }
export type Row = Record<string, string | number | null>;
export interface Filters { from?: string; to?: string; year?: number; categoryId?: string; locationId?: string; unitId?: string; condition?: string; status?: string; warehouseId?: string }
export interface ReportResult { rows: Row[]; summary?: { label: string; value: string | number; type?: ColType }[] }
export interface ReportDef {
  key: string; title: string; description: string; columns: Col[];
  /** Filter yang berlaku untuk laporan ini (dipakai UI untuk menampilkan kontrol). */
  filters: (keyof Filters)[];
  fetch(f: Filters, auth: AuthContext): Promise<ReportResult>;
}

export const MAX_ROWS = 20_000;
const day = (d?: Date | null) => (d ? d.toISOString().slice(0, 10) : null);
const dateRange = (f: Filters) => (f.from || f.to ? { gte: f.from ? new Date(f.from) : undefined, lte: f.to ? new Date(f.to) : undefined } : undefined);
const label = <T extends Record<string, string>>(m: T, k: string) => m[k] ?? k;
const sum = (rows: Row[], key: string) => rows.reduce((s, r) => s + Number(r[key] ?? 0), 0);

export const REPORTS: ReportDef[] = [
  {
    key: 'assets', title: 'Rekapitulasi Inventaris', description: 'Daftar aset individual beserta lokasi, unit, kondisi, dan nilai perolehan.',
    filters: ['categoryId', 'locationId', 'unitId', 'condition', 'status', 'year'],
    columns: [
      { key: 'code', header: 'Kode inventaris', width: 22 }, { key: 'item', header: 'Nama barang', width: 28 }, { key: 'category', header: 'Kategori', width: 16 },
      { key: 'serial', header: 'No. seri', width: 16 }, { key: 'year', header: 'Tahun', type: 'number', width: 8 }, { key: 'cost', header: 'Harga perolehan', type: 'money', width: 16 },
      { key: 'condition', header: 'Kondisi', width: 13 }, { key: 'status', header: 'Status', width: 14 }, { key: 'unit', header: 'Unit', width: 18 }, { key: 'location', header: 'Lokasi', width: 18 }, { key: 'person', header: 'Penanggung jawab', width: 18 },
    ],
    async fetch(f, auth) {
      const locIds = f.locationId ? await locationTreeIds(f.locationId) : null;
      const where: Prisma.AssetWhereInput = {
        ...unitScope(auth), archivedAt: null,
        ...(f.categoryId ? { item: { categoryId: f.categoryId } } : {}), ...(locIds ? { locationId: { in: locIds } } : {}),
        ...(f.unitId ? { unitId: f.unitId } : {}), ...(f.condition ? { condition: f.condition as never } : {}), ...(f.status ? { status: f.status as never } : {}),
        ...(f.year ? { acquisitionYear: f.year } : {}),
      };
      const assets = await prisma.asset.findMany({ where, take: MAX_ROWS, orderBy: { code: 'asc' }, include: { item: { select: { name: true, category: { select: { name: true } } } }, unit: { select: { name: true } }, location: { select: { name: true } }, person: { select: { name: true } } } });
      const rows = assets.map((a) => ({ code: a.code, item: a.item.name, category: a.item.category.name, serial: a.serialNumber, year: a.acquisitionYear, cost: a.acquisitionCost.toNumber(), condition: label(ASSET_CONDITION_LABEL, a.condition), status: label(ASSET_STATUS_LABEL, a.status), unit: a.unit.name, location: a.location.name, person: a.person?.name ?? null }));
      return { rows, summary: [{ label: 'Jumlah aset', value: rows.length, type: 'number' }, { label: 'Total nilai perolehan', value: sum(rows, 'cost'), type: 'money' }] };
    },
  },
  {
    key: 'stocks', title: 'Laporan Persediaan', description: 'Saldo persediaan dan pergerakan masuk/keluar pada periode.',
    filters: ['categoryId', 'warehouseId', 'from', 'to'],
    columns: [
      { key: 'code', header: 'Kode', width: 18 }, { key: 'name', header: 'Nama barang', width: 30 }, { key: 'category', header: 'Kategori', width: 18 }, { key: 'unit', header: 'Satuan', width: 10 },
      { key: 'qtyIn', header: 'Masuk (periode)', type: 'number', width: 14 }, { key: 'qtyOut', header: 'Keluar (periode)', type: 'number', width: 14 },
      { key: 'balance', header: 'Saldo', type: 'number', width: 12 }, { key: 'minStock', header: 'Minimum', type: 'number', width: 12 }, { key: 'state', header: 'Status stok', width: 14 },
    ],
    async fetch(f) {
      const items = await prisma.item.findMany({ where: { type: 'SUPPLY', isActive: true, ...(f.categoryId ? { categoryId: f.categoryId } : {}) }, orderBy: { name: 'asc' }, take: MAX_ROWS, include: { category: { select: { name: true } }, unitOfMeasure: { select: { name: true } } } });
      const ids = items.map((i) => i.id);
      const whWhere = f.warehouseId ? { warehouseId: f.warehouseId } : {};
      const [bal, mov] = await Promise.all([
        prisma.stockBalance.groupBy({ by: ['itemId'], where: { itemId: { in: ids }, ...whWhere }, _sum: { quantity: true } }),
        prisma.stockTransactionDetail.groupBy({ by: ['itemId'], where: { itemId: { in: ids }, ...whWhere, ...(dateRange(f) ? { transaction: { date: dateRange(f) } } : {}) }, _sum: { quantityIn: true, quantityOut: true } }),
      ]);
      const b = new Map(bal.map((x) => [x.itemId, x._sum.quantity?.toNumber() ?? 0]));
      const m = new Map(mov.map((x) => [x.itemId, x._sum]));
      const rows = items.map((i) => {
        const balance = b.get(i.id) ?? 0;
        return { code: i.code, name: i.name, category: i.category.name, unit: i.unitOfMeasure.name, qtyIn: m.get(i.id)?.quantityIn?.toNumber() ?? 0, qtyOut: m.get(i.id)?.quantityOut?.toNumber() ?? 0, balance, minStock: i.minStock.toNumber(), state: i.minStock.gt(0) && balance < i.minStock.toNumber() ? 'Menipis' : 'Aman' };
      });
      return { rows, summary: [{ label: 'Jenis barang', value: rows.length, type: 'number' }, { label: 'Di bawah minimum', value: rows.filter((r) => r.state === 'Menipis').length, type: 'number' }] };
    },
  },
  {
    key: 'conditions', title: 'Rekapitulasi Kondisi', description: 'Jumlah aset per kategori berdasarkan kondisi (tidak termasuk yang dihapuskan).',
    filters: ['unitId', 'locationId'],
    columns: [{ key: 'category', header: 'Kategori', width: 28 }, { key: 'good', header: 'Baik', type: 'number' }, { key: 'minor', header: 'Rusak ringan', type: 'number' }, { key: 'major', header: 'Rusak berat', type: 'number' }, { key: 'missing', header: 'Tidak ditemukan', type: 'number' }, { key: 'total', header: 'Total', type: 'number' }],
    async fetch(f, auth) {
      const locIds = f.locationId ? await locationTreeIds(f.locationId) : null;
      const assets = await prisma.asset.findMany({ where: { ...unitScope(auth), archivedAt: null, status: { not: 'DISPOSED' }, ...(f.unitId ? { unitId: f.unitId } : {}), ...(locIds ? { locationId: { in: locIds } } : {}) }, select: { condition: true, status: true, item: { select: { category: { select: { name: true } } } } } });
      const by = new Map<string, { good: number; minor: number; major: number; missing: number }>();
      for (const a of assets) {
        const k = a.item.category.name;
        const r = by.get(k) ?? { good: 0, minor: 0, major: 0, missing: 0 };
        if (a.status === 'MISSING') r.missing++; else if (a.condition === 'GOOD') r.good++; else if (a.condition === 'MINOR_DAMAGE') r.minor++; else r.major++;
        by.set(k, r);
      }
      const rows = [...by.entries()].sort(([x], [y]) => x.localeCompare(y)).map(([category, r]) => ({ category, ...r, total: r.good + r.minor + r.major + r.missing }));
      return { rows, summary: [{ label: 'Total aset', value: sum(rows, 'total'), type: 'number' }] };
    },
  },
  {
    key: 'mutations', title: 'Laporan Mutasi', description: 'Perpindahan aset antar unit, lokasi, dan penanggung jawab.',
    filters: ['from', 'to', 'status'],
    columns: [{ key: 'number', header: 'Nomor', width: 16 }, { key: 'date', header: 'Tanggal', type: 'date', width: 12 }, { key: 'status', header: 'Status', width: 18 }, { key: 'asset', header: 'Kode aset', width: 22 }, { key: 'item', header: 'Barang', width: 24 }, { key: 'from', header: 'Asal', width: 26 }, { key: 'to', header: 'Tujuan', width: 26 }, { key: 'reason', header: 'Alasan', width: 28 }],
    async fetch(f) {
      const ms = await prisma.assetMutation.findMany({ where: { ...(dateRange(f) ? { date: dateRange(f) } : {}), ...(f.status ? { status: f.status as never } : {}) }, orderBy: { date: 'desc' }, take: MAX_ROWS, include: { details: { include: { asset: { select: { code: true, item: { select: { name: true } } } } } } } });
      const ids = (k: 'fromLocationId' | 'toLocationId' | 'fromUnitId' | 'toUnitId') => [...new Set(ms.flatMap((m) => m.details.map((d) => d[k])))];
      const [locs, units] = await Promise.all([prisma.location.findMany({ where: { id: { in: [...ids('fromLocationId'), ...ids('toLocationId')] } }, select: { id: true, name: true } }), prisma.organizationalUnit.findMany({ where: { id: { in: [...ids('fromUnitId'), ...ids('toUnitId')] } }, select: { id: true, name: true } })]);
      const L = new Map(locs.map((x) => [x.id, x.name])), U = new Map(units.map((x) => [x.id, x.name]));
      const rows = ms.flatMap((m) => m.details.map((d) => ({ number: m.number, date: day(m.date), status: label(MUTATION_STATUS_LABEL, m.status), asset: d.asset.code, item: d.asset.item.name, from: `${L.get(d.fromLocationId)} (${U.get(d.fromUnitId)})`, to: `${L.get(d.toLocationId)} (${U.get(d.toUnitId)})`, reason: m.reason })));
      return { rows, summary: [{ label: 'Jumlah dokumen', value: ms.length, type: 'number' }, { label: 'Aset dimutasi', value: rows.length, type: 'number' }] };
    },
  },
  {
    key: 'loans', title: 'Laporan Peminjaman dan Pengembalian', description: 'Peminjaman aset, tanggal kembali, dan keterlambatan.',
    filters: ['from', 'to', 'status'],
    columns: [{ key: 'number', header: 'Nomor', width: 16 }, { key: 'borrower', header: 'Peminjam', width: 22 }, { key: 'loanDate', header: 'Tgl pinjam', type: 'date', width: 12 }, { key: 'due', header: 'Rencana kembali', type: 'date', width: 14 }, { key: 'returned', header: 'Dikembalikan', type: 'date', width: 12 }, { key: 'status', header: 'Status', width: 16 }, { key: 'assets', header: 'Aset', width: 36 }, { key: 'purpose', header: 'Keperluan', width: 28 }],
    async fetch(f) {
      const today = new Date(new Date().toISOString().slice(0, 10));
      const ls = await prisma.loan.findMany({ where: { ...(dateRange(f) ? { loanDate: dateRange(f) } : {}), ...(f.status ? { status: f.status as never } : {}) }, orderBy: { loanDate: 'desc' }, take: MAX_ROWS, include: { borrower: { select: { name: true } }, details: { include: { asset: { select: { code: true } } } } } });
      const rows = ls.map((l) => ({ number: l.number, borrower: l.borrower.name, loanDate: day(l.loanDate), due: day(l.expectedReturnDate), returned: day(l.returnedAt), status: label(LOAN_STATUS_LABEL, l.status === 'ACTIVE' && l.expectedReturnDate < today ? 'OVERDUE' : l.status), assets: l.details.map((d) => d.asset.code).join(', '), purpose: l.purpose }));
      return { rows, summary: [{ label: 'Jumlah peminjaman', value: rows.length, type: 'number' }, { label: 'Terlambat', value: rows.filter((r) => r.status === LOAN_STATUS_LABEL.OVERDUE).length, type: 'number' }] };
    },
  },
  {
    key: 'maintenances', title: 'Laporan Pemeliharaan', description: 'Riwayat pemeliharaan dan perbaikan beserta biaya.',
    filters: ['from', 'to', 'status'],
    columns: [{ key: 'number', header: 'Nomor', width: 16 }, { key: 'date', header: 'Tanggal', type: 'date', width: 12 }, { key: 'asset', header: 'Kode aset', width: 22 }, { key: 'item', header: 'Barang', width: 22 }, { key: 'type', header: 'Jenis', width: 12 }, { key: 'damage', header: 'Keluhan', width: 30 }, { key: 'action', header: 'Tindakan', width: 30 }, { key: 'cost', header: 'Biaya', type: 'money', width: 14 }, { key: 'status', header: 'Status', width: 18 }],
    async fetch(f) {
      const ms = await prisma.maintenance.findMany({ where: { ...(dateRange(f) ? { date: dateRange(f) } : {}), ...(f.status ? { status: f.status as never } : {}) }, orderBy: { date: 'desc' }, take: MAX_ROWS, include: { asset: { select: { code: true, item: { select: { name: true } } } } } });
      const rows = ms.map((m) => ({ number: m.number, date: day(m.date), asset: m.asset.code, item: m.asset.item.name, type: label(MAINTENANCE_TYPE_LABEL, m.type), damage: m.damageDescription, action: m.actionTaken, cost: m.cost.toNumber(), status: label(MAINTENANCE_STATUS_LABEL, m.status) }));
      return { rows, summary: [{ label: 'Jumlah', value: rows.length, type: 'number' }, { label: 'Total biaya', value: sum(rows, 'cost'), type: 'money' }] };
    },
  },
  {
    key: 'procurements', title: 'Laporan Pengadaan per Periode', description: 'Dokumen pengadaan, vendor, dan nilainya.',
    filters: ['from', 'to', 'status', 'year'],
    columns: [{ key: 'number', header: 'Nomor', width: 16 }, { key: 'date', header: 'Tanggal', type: 'date', width: 12 }, { key: 'fiscalYear', header: 'Tahun anggaran', type: 'number', width: 14 }, { key: 'vendor', header: 'Vendor', width: 26 }, { key: 'funding', header: 'Sumber dana', width: 18 }, { key: 'lines', header: 'Jenis barang', type: 'number', width: 12 }, { key: 'total', header: 'Total', type: 'money', width: 18 }, { key: 'status', header: 'Status', width: 20 }],
    async fetch(f) {
      const ps = await prisma.procurement.findMany({ where: { ...(dateRange(f) ? { date: dateRange(f) } : {}), ...(f.status ? { status: f.status as never } : {}), ...(f.year ? { fiscalYear: f.year } : {}) }, orderBy: { date: 'desc' }, take: MAX_ROWS, include: { vendor: { select: { name: true } }, fundingSource: { select: { name: true } }, _count: { select: { details: true } } } });
      const rows = ps.map((p) => ({ number: p.number, date: day(p.date), fiscalYear: p.fiscalYear, vendor: p.vendor.name, funding: p.fundingSource?.name ?? null, lines: p._count.details, total: p.totalAmount.toNumber(), status: label(PROCUREMENT_STATUS_LABEL, p.status) }));
      return { rows, summary: [{ label: 'Jumlah dokumen', value: rows.length, type: 'number' }, { label: 'Total nilai', value: sum(rows, 'total'), type: 'money' }] };
    },
  },
  {
    key: 'disposals', title: 'Laporan Penghapusan Aset', description: 'Pengajuan dan penghapusan aset.',
    filters: ['from', 'to', 'status'],
    columns: [{ key: 'number', header: 'Nomor', width: 16 }, { key: 'date', header: 'Tanggal', type: 'date', width: 12 }, { key: 'method', header: 'Cara', width: 14 }, { key: 'status', header: 'Status', width: 18 }, { key: 'assets', header: 'Aset', width: 40 }, { key: 'reason', header: 'Alasan', width: 34 }, { key: 'completed', header: 'Difinalisasi', type: 'date', width: 12 }],
    async fetch(f) {
      const ds = await prisma.disposal.findMany({ where: { ...(dateRange(f) ? { date: dateRange(f) } : {}), ...(f.status ? { status: f.status as never } : {}) }, orderBy: { date: 'desc' }, take: MAX_ROWS, include: { details: { include: { asset: { select: { code: true } } } } } });
      const rows = ds.map((d) => ({ number: d.number, date: day(d.date), method: label(DISPOSAL_METHOD_LABEL, d.method), status: label(DOC_STATUS_LABEL, d.status), assets: d.details.map((x) => x.asset.code).join(', '), reason: d.reason, completed: day(d.completedAt) }));
      return { rows, summary: [{ label: 'Jumlah dokumen', value: rows.length, type: 'number' }, { label: 'Aset', value: ds.reduce((s, d) => s + d.details.length, 0), type: 'number' }] };
    },
  },
  {
    key: 'stock-opnames', title: 'Laporan Stock Opname', description: 'Hasil pemeriksaan fisik per sesi.',
    filters: ['from', 'to', 'status'],
    columns: [{ key: 'number', header: 'Nomor', width: 16 }, { key: 'title', header: 'Judul', width: 30 }, { key: 'period', header: 'Periode', width: 24 }, { key: 'status', header: 'Status', width: 18 }, { key: 'total', header: 'Total', type: 'number' }, { key: 'match', header: 'Sesuai', type: 'number' }, { key: 'mismatch', header: 'Tidak sesuai', type: 'number' }, { key: 'notFound', header: 'Tidak ditemukan', type: 'number' }, { key: 'unregistered', header: 'Tidak terdaftar', type: 'number' }],
    async fetch(f) {
      const os = await prisma.stockOpname.findMany({ where: { ...(dateRange(f) ? { periodStart: dateRange(f) } : {}), ...(f.status ? { status: f.status as never } : {}) }, orderBy: { periodStart: 'desc' }, take: MAX_ROWS });
      const g = await prisma.stockOpnameDetail.groupBy({ by: ['opnameId', 'result'], where: { opnameId: { in: os.map((o) => o.id) } }, _count: true });
      const c = (id: string, r: string) => g.find((x) => x.opnameId === id && x.result === r)?._count ?? 0;
      const rows = os.map((o) => ({ number: o.number, title: o.title, period: `${day(o.periodStart)} s/d ${day(o.periodEnd)}`, status: label(OPNAME_STATUS_LABEL, o.status), total: g.filter((x) => x.opnameId === o.id).reduce((s, x) => s + x._count, 0), match: c(o.id, 'MATCH'), mismatch: c(o.id, 'MISMATCH'), notFound: c(o.id, 'NOT_FOUND'), unregistered: c(o.id, 'UNREGISTERED') }));
      return { rows, summary: [{ label: 'Jumlah sesi', value: rows.length, type: 'number' }] };
    },
  },
];

export const reportByKey = (key: string) => REPORTS.find((r) => r.key === key);
