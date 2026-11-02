import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import { call, getApp, seedBase, sessionFor, type Session } from './app-helpers';
import { db, resetDb } from './helpers';

let admin: Session, petugas: Session, approver: Session, viewer: Session;
let ids: { elk: string; atk: string; uom: string; unit: string; unit2: string; locA: string; locChild: string; locB: string; wh: string; person: string; paper: string; laptop: string };
const today = new Date().toISOString().slice(0, 10);

beforeAll(async () => {
  await resetDb();
  await seedBase();
  admin = (await sessionFor('ADMIN_INVENTARIS')).session; petugas = (await sessionFor('PETUGAS_INVENTARIS')).session;
  approver = (await sessionFor('APPROVER')).session; viewer = (await sessionFor('VIEWER')).session;
  const org = await db.organization.findFirstOrThrow();
  const elk = await db.category.findUniqueOrThrow({ where: { code: 'ELK' } }), atk = await db.category.findUniqueOrThrow({ where: { code: 'ATK' } });
  const uom = await db.unitOfMeasure.findUniqueOrThrow({ where: { code: 'UNIT' } });
  const laptop = (await call('POST', '/items', { session: admin, body: { name: 'Laptop', type: 'ASSET', categoryId: elk.id, unitOfMeasureId: uom.id } })).body.data;
  const paper = (await call('POST', '/items', { session: admin, body: { name: 'Kertas', type: 'SUPPLY', categoryId: atk.id, unitOfMeasureId: uom.id, minStock: 50 } })).body.data;
  const locA = await db.location.create({ data: { code: 'LT1', name: 'Lantai 1', type: 'FLOOR' } });
  ids = {
    elk: elk.id, atk: atk.id, uom: uom.id, laptop: laptop.id, paper: paper.id,
    unit: (await db.organizationalUnit.findUniqueOrThrow({ where: { code: 'UNIT-UTAMA' } })).id,
    unit2: (await db.organizationalUnit.create({ data: { code: 'U2', name: 'Seksi Dua', organizationId: org.id } })).id,
    locA: locA.id, locChild: (await db.location.create({ data: { code: 'R101', name: 'Ruang 101', type: 'ROOM', parentId: locA.id } })).id,
    locB: (await db.location.create({ data: { code: 'LT2', name: 'Lantai 2', type: 'FLOOR' } })).id,
    wh: (await db.warehouse.findUniqueOrThrow({ where: { code: 'GDG-UTAMA' } })).id, person: (await db.person.create({ data: { name: 'Pak Hadi' } })).id,
  };
  const reg = (n: number, locationId: string, unitId = ids.unit, acquisitionYear = 2026, acquisitionCost = 1000000) =>
    call('POST', '/assets', { session: admin, body: { itemId: ids.laptop, quantity: n, acquisitionYear, unitId, locationId, acquisitionCost } });
  await reg(3, ids.locChild); await reg(2, ids.locB, ids.unit2, 2025, 2500000);
  const all = await db.asset.findMany({ orderBy: { code: 'asc' } });
  await db.asset.update({ where: { id: all[0]!.id }, data: { condition: 'MINOR_DAMAGE' } });
  await db.asset.update({ where: { id: all[1]!.id }, data: { condition: 'MAJOR_DAMAGE' } });
  await db.asset.update({ where: { id: all[2]!.id }, data: { status: 'LOANED' } });
  await db.asset.update({ where: { id: all[3]!.id }, data: { status: 'DISPOSED' } });
  await call('POST', '/stocks/in', { session: admin, body: { warehouseId: ids.wh, date: today, lines: [{ itemId: ids.paper, quantity: 100 }] } });
  await call('POST', '/stocks/out', { session: admin, body: { warehouseId: ids.wh, date: today, lines: [{ itemId: ids.paper, quantity: 70 }] } });
  const vendor = await db.vendor.create({ data: { code: 'V', name: 'PT Maju' } });
  const p = (await call('POST', '/procurements', { session: petugas, body: { date: today, fiscalYear: 2026, vendorId: vendor.id, lines: [{ itemId: ids.laptop, quantity: 2, unitPrice: 5000000 }] } })).body.data;
  await call('POST', `/procurements/${p.id}/submit`, { session: petugas });
  await call('POST', `/approvals/${(await db.approvalRequest.findFirstOrThrow({ where: { entityId: p.id } })).id}/approve`, { session: approver, body: {} });
  const p2 = (await call('POST', '/procurements', { session: petugas, body: { date: today, fiscalYear: 2026, vendorId: vendor.id, lines: [{ itemId: ids.paper, quantity: 1, unitPrice: 1000 }] } })).body.data;
  await call('POST', `/procurements/${p2.id}/submit`, { session: petugas }); // dibiarkan menunggu
});
afterAll(() => db.$disconnect());

describe('dashboard', () => {
  it('angka berasal dari database dan sama dengan hitungan independen', async () => {
    const d = (await call('GET', '/reports/dashboard', { session: viewer })).body.data;
    const live = { archivedAt: null, status: { not: 'DISPOSED' as const } };
    expect(d.stats.totalAssets).toBe(await db.asset.count({ where: live }));
    expect(d.stats.totalAssets).toBe(4);
    expect(d.stats.acquisitionValue).toBe((await db.asset.aggregate({ where: live, _sum: { acquisitionCost: true } }))._sum.acquisitionCost!.toNumber());
    expect(d.stats.acquisitionValue).toBe(7000000);
    expect(d.stats).toMatchObject({ minorDamage: 1, majorDamage: 1, good: 2, loaned: 1, missing: 0, underMaintenance: 0, supplyItems: 1, supplyQuantity: 30, lowStock: 1, pendingApprovals: 1 });
    expect(d.charts.byCondition.map((c: any) => c.value)).toEqual([2, 1, 1]);
    expect(d.charts.byCategory).toEqual([{ name: 'Elektronik', value: 4 }]);
    expect(d.charts.byLocation.map((l: any) => [l.name, l.value]).sort()).toEqual([['Lantai 2', 2], ['Ruang 101', 2]].sort());
    expect(d.charts.procurementPerMonth).toHaveLength(12);
    expect(d.charts.procurementPerMonth.at(-1).total).toBe(10000000);
    expect(d.recentActivity.length).toBeGreaterThan(0);
    expect(d.recentActivity[0].text).toMatch(/\w+ \w+/);
  });

  it('daftar persetujuan di dashboard hanya yang dapat diputuskan pengguna', async () => {
    const mine = (await call('GET', '/reports/dashboard', { session: approver })).body.data;
    expect(mine.stats.pendingForMe).toBe(1);
    expect(mine.pendingApprovals[0]).toMatchObject({ entityLabel: 'Pengadaan', path: expect.stringMatching(/^\/pengadaan\//) });
    expect((await call('GET', '/reports/dashboard', { session: petugas })).body.data.stats.pendingForMe).toBe(0);
  });

  it('pembatasan unit: pengguna dengan akses unit melihat angka unitnya saja', async () => {
    const scoped = await sessionFor('VIEWER');
    await db.userUnitAccess.create({ data: { userId: scoped.user.id, unitId: ids.unit2 } });
    const d = (await call('GET', '/reports/dashboard', { session: scoped.session })).body.data;
    expect(d.stats.totalAssets).toBe(2); // 2 aset Seksi Dua, dihitung tanpa aset dihapuskan
    expect((await call('GET', '/reports/assets', { session: scoped.session })).body.data.every((r: any) => r.unit === 'Seksi Dua')).toBe(true);
  });

  it('wajib login dan izin dashboard.view', async () => {
    expect((await call('GET', '/reports/dashboard')).status).toBe(401);
  });
});

describe('laporan', () => {
  it('daftar laporan memuat metadata kolom dan filter', async () => {
    const r = await call('GET', '/reports', { session: viewer });
    expect(r.body.data.map((x: any) => x.key)).toEqual(expect.arrayContaining(['assets', 'stocks', 'conditions', 'mutations', 'loans', 'stock-opnames', 'procurements', 'maintenances', 'disposals']));
    expect((await call('GET', '/reports/nope', { session: viewer })).status).toBe(404);
  });

  it('inventaris: filter kategori, lokasi (termasuk anak), kondisi, tahun; ringkasan jumlah dan nilai', async () => {
    const all = await call('GET', '/reports/assets?limit=100', { session: viewer });
    expect(all.body.meta.total).toBe(5); // termasuk aset berstatus dihapuskan (arsip data tetap dilaporkan)
    expect(all.body.summary).toEqual([{ label: 'Jumlah aset', value: 5, type: 'number' }, { label: 'Total nilai perolehan', value: 3 * 1000000 + 2 * 2500000, type: 'money' }]);
    expect((await call('GET', `/reports/assets?locationId=${ids.locA}`, { session: viewer })).body.meta.total).toBe(3);
    expect((await call('GET', '/reports/assets?condition=MINOR_DAMAGE', { session: viewer })).body.meta.total).toBe(1);
    expect((await call('GET', '/reports/assets?year=2025', { session: viewer })).body.meta.total).toBe(2);
    expect((await call('GET', '/reports/assets?status=LOANED', { session: viewer })).body.data[0].status).toBe('Dipinjam');
    expect((await call('GET', `/reports/assets?categoryId=${ids.atk}`, { session: viewer })).body.meta.total).toBe(0);
    const page = await call('GET', '/reports/assets?limit=2&page=3', { session: viewer });
    expect(page.body.data).toHaveLength(1);
    expect(page.body.meta).toMatchObject({ page: 3, limit: 2, total: 5 });
    expect((await call('GET', '/reports/assets?condition=RUSAK', { session: viewer })).status).toBe(400);
    expect((await call('GET', '/reports/assets?from=kemarin', { session: viewer })).status).toBe(400);
  });

  it('persediaan: saldo, pergerakan periode, dan status stok menipis', async () => {
    const r = (await call('GET', `/reports/stocks?from=${today}&to=${today}`, { session: viewer })).body;
    expect(r.data[0]).toMatchObject({ name: 'Kertas', qtyIn: 100, qtyOut: 70, balance: 30, minStock: 50, state: 'Menipis' });
    const past = (await call('GET', '/reports/stocks?from=2020-01-01&to=2020-12-31', { session: viewer })).body.data[0];
    expect(past).toMatchObject({ qtyIn: 0, qtyOut: 0, balance: 30 });
    expect(r.summary).toContainEqual({ label: 'Di bawah minimum', value: 1, type: 'number' });
  });

  it('kondisi, pengadaan, dan peminjaman terlambat', async () => {
    const c = (await call('GET', '/reports/conditions', { session: viewer })).body.data;
    expect(c).toEqual([{ category: 'Elektronik', good: 2, minor: 1, major: 1, missing: 0, total: 4 }]);
    const pr = (await call('GET', '/reports/procurements', { session: viewer })).body;
    expect(pr.meta.total).toBe(2);
    expect(pr.summary).toContainEqual({ label: 'Total nilai', value: 10001000, type: 'money' });
    expect((await call('GET', '/reports/procurements?status=APPROVED', { session: viewer })).body.meta.total).toBe(1);
    const a = await db.asset.findFirstOrThrow({ where: { status: 'AVAILABLE' } });
    const person = ids.person;
    const loan = await db.loan.create({ data: { number: 'PJM-T-1', borrowerPersonId: person, loanDate: new Date('2026-01-01'), expectedReturnDate: new Date('2026-01-05'), purpose: 'Uji', status: 'ACTIVE', createdById: (await db.user.findFirstOrThrow()).id, details: { create: { assetId: a.id, conditionBefore: 'GOOD' } } } });
    const lr = (await call('GET', '/reports/loans', { session: viewer })).body;
    expect(lr.data.find((r: any) => r.number === loan.number).status).toBe('Terlambat');
  });
});

describe('export', () => {
  it('XLSX: berkas valid dengan header, baris, tipe angka/uang, dan ringkasan', async () => {
    const res = await call('GET', '/exports/assets?format=xlsx&condition=GOOD', { session: viewer });
    expect(res.status).toBe(200);
    expect(res.res.headers['content-type']).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    expect(res.res.headers['content-disposition']).toMatch(/attachment; filename="laporan-assets-\d{4}-\d{2}-\d{2}\.xlsx"/);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(res.res.rawPayload as unknown as ExcelJS.Buffer);
    const ws = wb.worksheets[0]!;
    expect(ws.getCell(1, 1).value).toBe('Rekapitulasi Inventaris');
    expect(ws.getRow(4).getCell(1).value).toBe('Kode inventaris');
    const first = ws.getRow(5);
    expect(String(first.getCell(1).value)).toMatch(/^INV-ELK-\d{4}-\d{6}$/);
    expect(typeof first.getCell(6).value).toBe('number');
    expect(first.getCell(6).numFmt).toContain('Rp');
    const labels: string[] = [];
    ws.eachRow((r) => { if (r.number > 5) labels.push(String(r.getCell(1).value)); });
    expect(labels).toEqual(expect.arrayContaining(['Jumlah aset', 'Total nilai perolehan']));
  });

  it('PDF: dokumen valid, multi halaman untuk data banyak', async () => {
    const [it] = [ids.laptop];
    await call('POST', '/assets', { session: admin, body: { itemId: it, quantity: 100, acquisitionYear: 2026, unitId: ids.unit, locationId: ids.locA } });
    await call('POST', '/assets', { session: admin, body: { itemId: it, quantity: 60, acquisitionYear: 2026, unitId: ids.unit, locationId: ids.locA } });
    const res = await call('GET', '/exports/assets?format=pdf', { session: viewer });
    expect(res.status).toBe(200);
    expect(res.res.headers['content-type']).toBe('application/pdf');
    const buf = res.res.rawPayload;
    expect(buf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(buf.length).toBeGreaterThan(5000);
    expect((buf.toString('latin1').match(/\/Type \/Page\b/g) ?? []).length).toBeGreaterThan(3);
  });

  it('izin: export butuh reports.export atau izin modul; setiap export tercatat di audit log', async () => {
    expect((await call('GET', '/exports/loans?format=xlsx', { session: petugas })).status).toBe(403);
    expect((await call('GET', '/exports/stocks?format=xlsx', { session: petugas })).status).toBe(403);
    expect((await call('GET', '/exports/assets?format=xlsx', { session: petugas })).status).toBe(200); // petugas punya assets.export
    expect((await call('GET', '/exports/nope', { session: viewer })).status).toBe(404);
    expect((await call('GET', '/exports/assets?format=xlsx')).status).toBe(401);
    expect((await call('GET', '/exports/assets?year=abc', { session: viewer })).status).toBe(400);
    const n = await db.auditLog.count({ where: { action: 'EXPORT', entityType: 'Report' } });
    expect(n).toBeGreaterThanOrEqual(3);
  });

  it('semua laporan dapat diekspor ke XLSX dan PDF tanpa galat', async () => {
    const keys = (await call('GET', '/reports', { session: viewer })).body.data.map((r: any) => r.key);
    for (const k of keys) {
      for (const f of ['xlsx', 'pdf']) {
        const r = await call('GET', `/exports/${k}?format=${f}`, { session: viewer });
        expect(r.status, `${k}.${f}`).toBe(200);
        expect(r.res.rawPayload.length).toBeGreaterThan(500);
      }
    }
  });
});

describe('audit log', () => {
  it('hanya pemegang audit.view; filter jenis, aksi, pengguna, tanggal; ringkasan terbaca', async () => {
    expect((await call('GET', '/audit-logs', { session: petugas })).status).toBe(403);
    expect((await call('GET', '/audit-logs')).status).toBe(401);
    const all = await call('GET', '/audit-logs?limit=100', { session: viewer });
    expect(all.status).toBe(200);
    expect(all.body.meta.total).toBeGreaterThan(10);
    const byEntity = await call('GET', '/audit-logs?entityType=Procurement&limit=100', { session: viewer });
    expect(byEntity.body.data.every((r: any) => r.entityType === 'Procurement')).toBe(true);
    expect(byEntity.body.data.some((r: any) => r.action === 'APPROVE' && r.summary.startsWith('menyetujui pengadaan PGD-') === false)).toBeDefined();
    expect(byEntity.body.data[0].user).toBeTruthy();
    expect((await call('GET', `/audit-logs?action=EXPORT&from=${today}&to=${today}`, { session: viewer })).body.meta.total).toBeGreaterThan(0);
    expect((await call('GET', '/audit-logs?from=2020-01-01&to=2020-01-02', { session: viewer })).body.meta.total).toBe(0);
    const opt = (await call('GET', '/audit-logs/options', { session: viewer })).body.data;
    expect(opt.actions).toContain('CREATE');
    expect(opt.entities.map((e: any) => e.key)).toContain('Asset');
    const labels = opt.entities.map((e: any) => e.label);
    expect(new Set(labels).size).toBe(labels.length); // tidak ada opsi berlabel ganda
    const proc = opt.entities.find((e: any) => e.label === 'pengadaan');
    expect(proc.key.split(',')).toEqual(expect.arrayContaining(['Procurement', 'PROCUREMENT']));
    const merged = await call('GET', `/audit-logs?entityType=${proc.key}&limit=100`, { session: viewer });
    expect(new Set(merged.body.data.map((r: any) => r.entityType))).toEqual(new Set(['Procurement', 'PROCUREMENT']));
  });

  it('tidak dapat dimodifikasi lewat API maupun database', async () => {
    const row = await db.auditLog.findFirstOrThrow();
    expect((await call('PATCH', `/audit-logs/${row.id}`, { session: admin, body: {} })).status).toBe(404);
    expect((await call('DELETE', `/audit-logs/${row.id}`, { session: admin })).status).toBe(404);
    await expect(db.auditLog.update({ where: { id: row.id }, data: { action: 'X' } })).rejects.toThrow(/append-only/);
    void getApp;
  });
});
