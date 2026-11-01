import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { call, seedBase, sessionFor, type Session } from './app-helpers';
import { db, resetDb } from './helpers';
import { sweepLoans } from '../src/modules/loans/service';

let petugas: Session, admin: Session, approver: Session, approver2: Session, viewer: Session, root: Session;
let ids: { item: string; unit: string; unit2: string; loc1: string; loc2: string; person: string; person2: string; wh: string; paper: string };
const today = new Date().toISOString().slice(0, 10);
const day = (offset: number) => new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);

beforeAll(async () => {
  await resetDb();
  await seedBase();
  petugas = (await sessionFor('PETUGAS_INVENTARIS')).session;
  admin = (await sessionFor('ADMIN_INVENTARIS')).session;
  approver = (await sessionFor('APPROVER')).session;
  approver2 = (await sessionFor('APPROVER')).session;
  viewer = (await sessionFor('VIEWER')).session;
  root = (await sessionFor('SUPER_ADMIN')).session;
  const org = await db.organization.findFirstOrThrow();
  const cat = await db.category.findUniqueOrThrow({ where: { code: 'ELK' } });
  const atk = await db.category.findUniqueOrThrow({ where: { code: 'ATK' } });
  const uom = await db.unitOfMeasure.findUniqueOrThrow({ where: { code: 'UNIT' } });
  const item = (await call('POST', '/items', { session: admin, body: { name: 'Laptop', type: 'ASSET', categoryId: cat.id, unitOfMeasureId: uom.id } })).body.data;
  const paper = (await call('POST', '/items', { session: admin, body: { name: 'Kertas', type: 'SUPPLY', categoryId: atk.id, unitOfMeasureId: uom.id, minStock: 50 } })).body.data;
  ids = {
    item: item.id, paper: paper.id,
    unit: (await db.organizationalUnit.findUniqueOrThrow({ where: { code: 'UNIT-UTAMA' } })).id,
    unit2: (await db.organizationalUnit.create({ data: { code: 'U-2', name: 'Seksi Dua', organizationId: org.id } })).id,
    loc1: (await db.location.create({ data: { code: 'R-1', name: 'Ruang 1', type: 'ROOM' } })).id,
    loc2: (await db.location.create({ data: { code: 'R-2', name: 'Ruang 2', type: 'ROOM' } })).id,
    person: (await db.person.create({ data: { name: 'Pak Hadi' } })).id,
    person2: (await db.person.create({ data: { name: 'Bu Sari' } })).id,
    wh: (await db.warehouse.findUniqueOrThrow({ where: { code: 'GDG-UTAMA' } })).id,
  };
});
afterAll(() => db.$disconnect());

const mkAssets = async (n: number) =>
  (await call('POST', '/assets', { session: admin, body: { itemId: ids.item, quantity: n, acquisitionYear: 2026, unitId: ids.unit, locationId: ids.loc1, personId: ids.person } })).body.data as { id: string; code: string }[];
const approve = async (entityId: string, s = approver) => {
  const r = await db.approvalRequest.findFirstOrThrow({ where: { entityId, status: 'PENDING' } });
  return call('POST', `/approvals/${r.id}/approve`, { session: s, body: {} });
};
const assetRow = (id: string) => db.asset.findUniqueOrThrow({ where: { id } });

describe('mutasi aset dengan persetujuan', () => {
  it('lokasi berubah hanya setelah disetujui, dipindahkan, dan dikonfirmasi; histori tersimpan', async () => {
    const [a] = await mkAssets(1);
    const m = (await call('POST', '/mutations', { session: petugas, body: { date: today, reason: 'Pindah ruang kerja', lines: [{ assetId: a!.id, toUnitId: ids.unit2, toLocationId: ids.loc2, toPersonId: ids.person2 }] } })).body.data;
    expect(m.number).toMatch(/^MTS-\d{4}-\d{4}$/);
    expect((await call('POST', `/mutations/${m.id}/submit`, { session: petugas })).status).toBe(200);
    expect((await assetRow(a!.id)).locationId).toBe(ids.loc1);
    // tidak bisa dipindah/dikonfirmasi sebelum disetujui
    expect((await call('POST', `/mutations/${m.id}/move`, { session: petugas })).status).toBe(422);
    expect((await call('POST', `/mutations/${m.id}/complete`, { session: petugas })).status).toBe(422);
    expect((await approve(m.id, petugas)).status).toBe(403);
    expect((await approve(m.id)).status).toBe(200);
    // setelah disetujui pun lokasi belum berubah
    expect((await assetRow(a!.id)).locationId).toBe(ids.loc1);
    expect((await call('POST', `/mutations/${m.id}/complete`, { session: petugas })).status).toBe(422);
    expect((await call('POST', `/mutations/${m.id}/move`, { session: viewer })).status).toBe(403);
    expect((await call('POST', `/mutations/${m.id}/move`, { session: petugas })).status).toBe(200);
    expect((await assetRow(a!.id)).locationId).toBe(ids.loc1);
    expect((await call('POST', `/mutations/${m.id}/complete`, { session: petugas })).status).toBe(200);
    const after = await assetRow(a!.id);
    expect([after.locationId, after.unitId, after.personId]).toEqual([ids.loc2, ids.unit2, ids.person2]);
    const hist = (await call('GET', `/assets/${a!.id}/history`, { session: viewer })).body.data.location;
    expect(hist[0]).toMatchObject({ sourceType: 'MUTATION', fromLocation: 'Ruang 1', toLocation: 'Ruang 2', fromPerson: 'Pak Hadi', toPerson: 'Bu Sari' });
    expect(hist).toHaveLength(2);
    expect((await call('GET', `/mutations/${m.id}`, { session: viewer })).body.data).toMatchObject({ status: 'COMPLETED' });
    expect((await call('POST', `/mutations/${m.id}/complete`, { session: petugas })).status).toBe(422);
    expect(await db.auditLog.count({ where: { entityId: m.id, action: 'MUTATION_COMPLETE' } })).toBe(1);
  });

  it('atomik: kegagalan di aset kedua saat konfirmasi membatalkan perpindahan aset pertama', async () => {
    const [a, b] = await mkAssets(2);
    const m = (await call('POST', '/mutations', { session: petugas, body: { date: today, reason: 'Atomik', lines: [a!, b!].map((x) => ({ assetId: x.id, toUnitId: ids.unit2, toLocationId: ids.loc2 })) } })).body.data;
    await call('POST', `/mutations/${m.id}/submit`, { session: petugas });
    await approve(m.id);
    await call('POST', `/mutations/${m.id}/move`, { session: petugas });
    // aset kedua tiba-tiba berubah (misalnya dipindah manual di database) sebelum konfirmasi
    await db.asset.update({ where: { id: b!.id }, data: { locationId: ids.loc2, unitId: ids.unit2 } });
    const r = await call('POST', `/mutations/${m.id}/complete`, { session: petugas });
    expect(r.status).toBe(409);
    expect((await assetRow(a!.id)).locationId).toBe(ids.loc1);
    expect(await db.assetLocationHistory.count({ where: { assetId: a!.id, sourceType: 'MUTATION' } })).toBe(0);
    expect((await db.assetMutation.findUniqueOrThrow({ where: { id: m.id } })).status).toBe('IN_TRANSFER');
  });

  it('aturan: satu aset tidak bisa ada di dua mutasi terbuka, tujuan sama ditolak, aset dipinjam ditolak, tolak lalu perbaiki', async () => {
    const [a, b] = await mkAssets(2);
    const line = (x: { id: string }) => ({ assetId: x.id, toUnitId: ids.unit2, toLocationId: ids.loc2 });
    const m1 = await call('POST', '/mutations', { session: petugas, body: { date: today, reason: 'A', lines: [line(a!)] } });
    expect(m1.status).toBe(201);
    const dup = await call('POST', '/mutations', { session: petugas, body: { date: today, reason: 'B', lines: [line(a!)] } });
    expect(dup.status).toBe(422);
    expect(dup.body.errors[0].message).toMatch(/sudah ada di mutasi MTS-/);
    const same = await call('POST', '/mutations', { session: petugas, body: { date: today, reason: 'C', lines: [{ assetId: b!.id, toUnitId: ids.unit, toLocationId: ids.loc1, toPersonId: ids.person }] } });
    expect(same.status).toBe(422);
    await db.asset.update({ where: { id: b!.id }, data: { status: 'LOANED' } });
    expect((await call('POST', '/mutations', { session: petugas, body: { date: today, reason: 'D', lines: [line(b!)] } })).status).toBe(422);
    await db.asset.update({ where: { id: b!.id }, data: { status: 'DISPOSED' } });
    expect((await call('POST', '/mutations', { session: petugas, body: { date: today, reason: 'D', lines: [line(b!)] } })).status).toBe(422);

    await call('POST', `/mutations/${m1.body.data.id}/submit`, { session: petugas });
    const reqId = (await db.approvalRequest.findFirstOrThrow({ where: { entityId: m1.body.data.id } })).id;
    expect((await call('POST', `/approvals/${reqId}/reject`, { session: approver, body: { note: 'Belum perlu' } })).status).toBe(200);
    expect((await call('POST', `/mutations/${m1.body.data.id}/move`, { session: petugas })).status).toBe(422);
    expect((await call('PATCH', `/mutations/${m1.body.data.id}`, { session: petugas, body: { date: today, reason: 'A (revisi)', lines: [line(a!)] } })).status).toBe(200);
    // yang sudah disetujui tidak boleh diedit
    await call('POST', `/mutations/${m1.body.data.id}/submit`, { session: petugas });
    await approve(m1.body.data.id, approver2);
    expect((await call('PATCH', `/mutations/${m1.body.data.id}`, { session: petugas, body: { date: today, reason: 'ubah diam-diam', lines: [line(a!)] } })).status).toBe(422);
    expect((await call('POST', `/mutations/${m1.body.data.id}/cancel`, { session: petugas })).status).toBe(200);
    expect((await assetRow(a!.id)).locationId).toBe(ids.loc1);
  });
});

describe('peminjaman dan pengembalian', () => {
  const mkLoan = (session: Session, assetIds: string[], extra: object = {}) =>
    call('POST', '/loans', { session, body: { borrowerPersonId: ids.person2, loanDate: today, expectedReturnDate: day(3), purpose: 'Rapat luar kantor', assetIds, ...extra } });

  it('alur penuh: pinjam, setujui, serah terima, kembalikan dengan kondisi; histori kondisi dan status', async () => {
    const [a] = await mkAssets(1);
    const l = (await mkLoan(petugas, [a!.id])).body.data;
    expect(l.number).toMatch(/^PJM-\d{4}-\d{4}$/);
    expect((await assetRow(a!.id)).status).toBe('AVAILABLE');
    expect((await call('POST', `/loans/${l.id}/handover`, { session: petugas })).status).toBe(422);
    await call('POST', `/loans/${l.id}/submit`, { session: petugas });
    expect((await approve(l.id, petugas)).status).toBe(403);
    expect((await approve(l.id)).status).toBe(200);
    expect((await assetRow(a!.id)).status).toBe('AVAILABLE');
    expect((await call('POST', `/loans/${l.id}/handover`, { session: viewer })).status).toBe(403);
    expect((await call('POST', `/loans/${l.id}/handover`, { session: petugas })).status).toBe(200);
    expect((await assetRow(a!.id)).status).toBe('LOANED');
    expect((await call('GET', `/loans/${l.id}`, { session: viewer })).body.data.status).toBe('ACTIVE');

    expect((await call('POST', `/loans/${l.id}/return`, { session: petugas, body: { returns: [] } })).status).toBe(400);
    expect((await call('POST', `/loans/${l.id}/return`, { session: viewer, body: { returns: [{ assetId: a!.id, conditionAfter: 'GOOD' }] } })).status).toBe(403);
    const ret = await call('POST', `/loans/${l.id}/return`, { session: petugas, body: { returns: [{ assetId: a!.id, conditionAfter: 'MINOR_DAMAGE', notes: 'Casing lecet' }] } });
    expect(ret.status).toBe(200);
    expect(ret.body.data.remaining).toBe(0);
    const after = await assetRow(a!.id);
    expect([after.status, after.condition]).toEqual(['AVAILABLE', 'MINOR_DAMAGE']);
    expect((await call('GET', `/loans/${l.id}`, { session: viewer })).body.data.status).toBe('RETURNED');
    const hist = (await call('GET', `/assets/${a!.id}/history`, { session: viewer })).body.data;
    expect(hist.condition.map((h: any) => h.sourceType)).toEqual(['RETURN', 'LOAN', 'REGISTRATION']);
    expect(hist.condition[0]).toMatchObject({ fromCondition: 'GOOD', toCondition: 'MINOR_DAMAGE', note: 'Casing lecet' });
    expect(hist.loans[0].loan.number).toBe(l.number);
    expect((await call('POST', `/loans/${l.id}/return`, { session: petugas, body: { returns: [{ assetId: a!.id, conditionAfter: 'GOOD' }] } })).status).toBe(422);
    // setelah kembali, aset dapat dipinjam lagi
    const again = await mkLoan(petugas, [a!.id]);
    expect(again.status).toBe(201);
    expect((await call('POST', `/loans/${again.body.data.id}/submit`, { session: petugas })).status).toBe(200);
  });

  it('pinjam ganda ditolak: setelah diajukan, aset yang sama tidak bisa diajukan pengguna lain; aset dipinjam tidak bisa dibuat pinjaman baru', async () => {
    const [a] = await mkAssets(1);
    const l1 = (await mkLoan(petugas, [a!.id])).body.data;
    const l2 = (await mkLoan(admin, [a!.id], { borrowerPersonId: ids.person })).body.data; // draft belum mengunci
    expect((await call('POST', `/loans/${l1.id}/submit`, { session: petugas })).status).toBe(200);
    const second = await call('POST', `/loans/${l2.id}/submit`, { session: admin });
    expect(second.status).toBe(409);
    expect(second.body.message).toMatch(/peminjaman lain/);
    expect((await db.loan.findUniqueOrThrow({ where: { id: l2.id } })).status).toBe('DRAFT');
    // serah terima l1 -> aset LOANED -> pinjaman baru ditolak sejak pembuatan
    await approve(l1.id);
    await call('POST', `/loans/${l1.id}/handover`, { session: petugas });
    const third = await mkLoan(admin, [a!.id]);
    expect(third.status).toBe(422);
    expect(third.body.errors[0].message).toMatch(/sedang dipinjam/);
    // pinjaman ditolak/dibatalkan melepas kunci
    const [b] = await mkAssets(1);
    const x = (await mkLoan(petugas, [b!.id])).body.data;
    await call('POST', `/loans/${x.id}/submit`, { session: petugas });
    const y = (await mkLoan(admin, [b!.id])).body.data;
    expect((await call('POST', `/loans/${y.id}/submit`, { session: admin })).status).toBe(409);
    const reqId = (await db.approvalRequest.findFirstOrThrow({ where: { entityId: x.id } })).id;
    await call('POST', `/approvals/${reqId}/reject`, { session: approver, body: { note: 'Tidak disetujui' } });
    expect((await call('POST', `/loans/${y.id}/submit`, { session: admin })).status).toBe(200);
  });

  it('pengajuan serentak untuk aset yang sama: hanya satu berhasil (partial unique index)', async () => {
    const [a] = await mkAssets(1);
    const drafts = await Promise.all([petugas, admin, root].map((s) => mkLoan(s, [a!.id])));
    const results = await Promise.all(drafts.map((d, i) => call('POST', `/loans/${d.body.data.id}/submit`, { session: [petugas, admin, root][i]! })));
    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    expect(results.filter((r) => r.status === 409)).toHaveLength(2);
    expect(await db.loanDetail.count({ where: { assetId: a!.id, isOpen: true } })).toBe(1);
  });

  it('aset dalam perbaikan, dihapuskan, atau diarsipkan tidak dapat dipinjam', async () => {
    const [a, b, c] = await mkAssets(3);
    await db.asset.update({ where: { id: a!.id }, data: { status: 'UNDER_MAINTENANCE' } });
    await db.asset.update({ where: { id: b!.id }, data: { status: 'DISPOSED' } });
    await db.asset.update({ where: { id: c!.id }, data: { archivedAt: new Date() } });
    for (const [x, msg] of [[a, /perbaikan/], [b, /dihapuskan/], [c, /diarsipkan/]] as const) {
      const r = await mkLoan(petugas, [x!.id]);
      expect(r.status).toBe(422);
      expect(r.body.errors[0].message).toMatch(msg);
    }
  });

  it('validasi tanggal dan pengembalian sebagian', async () => {
    const [a, b] = await mkAssets(2);
    expect((await mkLoan(petugas, [a!.id], { expectedReturnDate: day(-1) })).status).toBe(400);
    expect((await mkLoan(petugas, [a!.id, a!.id])).status).toBe(400);
    const l = (await mkLoan(petugas, [a!.id, b!.id])).body.data;
    await call('POST', `/loans/${l.id}/submit`, { session: petugas });
    await approve(l.id);
    await call('POST', `/loans/${l.id}/handover`, { session: petugas });
    const part = await call('POST', `/loans/${l.id}/return`, { session: petugas, body: { returns: [{ assetId: a!.id, conditionAfter: 'GOOD' }] } });
    expect(part.body.data.remaining).toBe(1);
    expect((await call('GET', `/loans/${l.id}`, { session: viewer })).body.data.status).toBe('ACTIVE');
    expect((await assetRow(b!.id)).status).toBe('LOANED');
    const foreign = (await mkAssets(1))[0]!;
    expect((await call('POST', `/loans/${l.id}/return`, { session: petugas, body: { returns: [{ assetId: foreign.id, conditionAfter: 'GOOD' }] } })).status).toBe(422);
    await call('POST', `/loans/${l.id}/return`, { session: petugas, body: { returns: [{ assetId: b!.id, conditionAfter: 'GOOD' }] } });
    expect((await call('GET', `/loans/${l.id}`, { session: viewer })).body.data.status).toBe('RETURNED');
  });

  it('keterlambatan: sweep menandai OVERDUE dan mengirim notifikasi satu kali', async () => {
    const [a] = await mkAssets(1);
    const l = (await mkLoan(petugas, [a!.id], { loanDate: day(-10), expectedReturnDate: day(-2) })).body.data;
    await call('POST', `/loans/${l.id}/submit`, { session: petugas });
    await approve(l.id);
    await call('POST', `/loans/${l.id}/handover`, { session: petugas });
    const listed = await call('GET', '/loans?status=ACTIVE', { session: viewer });
    expect(listed.body.data.find((x: any) => x.id === l.id).displayStatus).toBe('OVERDUE');
    await sweepLoans();
    await sweepLoans();
    expect((await db.loan.findUniqueOrThrow({ where: { id: l.id } })).status).toBe('OVERDUE');
    expect(await db.notification.count({ where: { entityId: l.id, type: 'loan.overdue', userId: (await db.loan.findUniqueOrThrow({ where: { id: l.id } })).createdById } })).toBe(1);
    // loan terlambat tetap bisa dikembalikan
    expect((await call('POST', `/loans/${l.id}/return`, { session: petugas, body: { returns: [{ assetId: a!.id, conditionAfter: 'GOOD' }] } })).status).toBe(200);
    expect((await call('POST', '/loans/sweep', { session: viewer })).status).toBe(403);
    expect((await call('POST', '/loans/sweep', { session: petugas })).status).toBe(200);
  });
});

describe('penyesuaian stok dengan persetujuan', () => {
  const seedStock = (qty: number) => call('POST', '/stocks/in', { session: petugas, body: { warehouseId: ids.wh, date: today, lines: [{ itemId: ids.paper, quantity: qty }] } });
  const adj = (delta: number) => call('POST', '/stocks/adjustments', { session: petugas, body: { itemId: ids.paper, warehouseId: ids.wh, quantityDelta: delta, reason: 'Hasil hitung fisik' } });
  const bal = async () => (await db.stockBalance.findFirst({ where: { itemId: ids.paper, warehouseId: ids.wh } }))?.quantity.toString() ?? '0';

  it('saldo hanya berubah setelah disetujui; ledger mencatat transaksi ADJUSTMENT yang dapat diaudit', async () => {
    await seedStock(100);
    const a = (await adj(-8)).body.data;
    expect(a.number).toMatch(/^PNY-\d{4}-\d{4}$/);
    await call('POST', `/stocks/adjustments/${a.id}/submit`, { session: petugas });
    expect(await bal()).toBe('100');
    expect((await approve(a.id, petugas)).status).toBe(403);
    expect((await approve(a.id)).status).toBe(200);
    expect(await bal()).toBe('92');
    const detail = (await call('GET', `/stocks/adjustments/${a.id}`, { session: viewer })).body.data;
    expect(detail.status).toBe('COMPLETED');
    expect(detail.transactionId).toBeTruthy();
    const tx = await db.stockTransaction.findUniqueOrThrow({ where: { id: detail.transactionId }, include: { details: true } });
    expect(tx).toMatchObject({ type: 'ADJUSTMENT', sourceType: 'ADJUSTMENT', sourceId: a.id });
    expect(tx.details[0]!.quantityOut.toString()).toBe('8');
    expect(tx.details[0]!.balanceAfter.toString()).toBe('92');
  });

  it('penyesuaian yang membuat stok negatif gagal saat disetujui dan tetap menunggu (tidak ada keputusan setengah jalan)', async () => {
    const before = Number(await bal());
    const a = (await adj(-(before + 50))).body.data;
    await call('POST', `/stocks/adjustments/${a.id}/submit`, { session: petugas });
    const r = await approve(a.id);
    expect(r.status).toBe(422);
    expect(Number(await bal())).toBe(before);
    expect((await db.stockAdjustment.findUniqueOrThrow({ where: { id: a.id } })).status).toBe('PENDING_APPROVAL');
    expect((await db.approvalRequest.findFirstOrThrow({ where: { entityId: a.id } })).status).toBe('PENDING');
    expect(await db.approvalAction.count({ where: { request: { entityId: a.id }, action: 'APPROVE' } })).toBe(0);
    expect((await call('POST', `/approvals/${(await db.approvalRequest.findFirstOrThrow({ where: { entityId: a.id } })).id}/reject`, { session: approver, body: { note: 'Angka tidak masuk akal' } })).status).toBe(200);
  });

  it('validasi: selisih 0, barang aset, dan penyesuaian ditolak tidak mengubah saldo', async () => {
    expect((await adj(0)).status).toBe(400);
    expect((await call('POST', '/stocks/adjustments', { session: petugas, body: { itemId: ids.item, warehouseId: ids.wh, quantityDelta: 1, reason: 'x' } })).status).toBe(422);
    expect((await call('POST', '/stocks/adjustments', { session: viewer, body: { itemId: ids.paper, warehouseId: ids.wh, quantityDelta: 1, reason: 'x' } })).status).toBe(403);
    const before = await bal();
    const a = (await adj(5)).body.data;
    await call('POST', `/stocks/adjustments/${a.id}/submit`, { session: petugas });
    const reqId = (await db.approvalRequest.findFirstOrThrow({ where: { entityId: a.id } })).id;
    await call('POST', `/approvals/${reqId}/reject`, { session: approver, body: { note: 'Tidak sesuai' } });
    expect(await bal()).toBe(before);
    expect((await call('GET', '/stocks/adjustments?status=REJECTED', { session: viewer })).body.data.some((x: any) => x.id === a.id)).toBe(true);
  });

  it('stok menipis: pengeluaran di bawah minimum memicu satu notifikasi per hari', async () => {
    const out = (q: number) => call('POST', '/stocks/out', { session: admin, body: { warehouseId: ids.wh, date: today, lines: [{ itemId: ids.paper, quantity: q }] } });
    // minimum 50: pengeluaran yang masih di atas minimum tidak memicu apa pun
    await out(Number(await bal()) - 60);
    expect(await db.notification.count({ where: { type: 'stock.low' } })).toBe(0);
    await out(20);
    await out(1);
    const n = await db.notification.findMany({ where: { type: 'stock.low', entityId: ids.paper, userId: (await db.user.findFirstOrThrow({ where: { roles: { some: { role: { code: 'PETUGAS_INVENTARIS' } } } } })).id } });
    expect(n).toHaveLength(1);
    expect(n[0]!.title).toMatch(/Stok menipis: Kertas/);
  });
});
