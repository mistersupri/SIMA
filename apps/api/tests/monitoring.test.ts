import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { call, getApp, seedBase, sessionFor, type Session } from './app-helpers';
import { db, resetDb } from './helpers';

let petugas: Session, petugasId: string, petugas2: Session, admin: Session, adminId: string, approver: Session, approver2: Session, viewer: Session, root: Session;
let ids: { item: string; unit: string; locA: string; locB: string; locChild: string; person: string };
const today = new Date().toISOString().slice(0, 10);
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');

beforeAll(async () => {
  await resetDb();
  await seedBase();
  const p = await sessionFor('PETUGAS_INVENTARIS'); petugas = p.session; petugasId = p.user.id;
  petugas2 = (await sessionFor('PETUGAS_INVENTARIS')).session;
  const a = await sessionFor('ADMIN_INVENTARIS'); admin = a.session; adminId = a.user.id;
  approver = (await sessionFor('APPROVER')).session; approver2 = (await sessionFor('APPROVER')).session;
  viewer = (await sessionFor('VIEWER')).session; root = (await sessionFor('SUPER_ADMIN')).session;
  const cat = await db.category.findUniqueOrThrow({ where: { code: 'ELK' } });
  const uom = await db.unitOfMeasure.findUniqueOrThrow({ where: { code: 'UNIT' } });
  const item = (await call('POST', '/items', { session: admin, body: { name: 'Laptop', type: 'ASSET', categoryId: cat.id, unitOfMeasureId: uom.id } })).body.data;
  const locA = await db.location.create({ data: { code: 'LT-1', name: 'Lantai 1', type: 'FLOOR' } });
  ids = {
    item: item.id, unit: (await db.organizationalUnit.findUniqueOrThrow({ where: { code: 'UNIT-UTAMA' } })).id,
    locA: locA.id, locB: (await db.location.create({ data: { code: 'LT-2', name: 'Lantai 2', type: 'FLOOR' } })).id,
    locChild: (await db.location.create({ data: { code: 'R-101', name: 'Ruang 101', type: 'ROOM', parentId: locA.id } })).id,
    person: (await db.person.create({ data: { name: 'Pak Hadi' } })).id,
  };
});
afterAll(() => db.$disconnect());

const mkAssets = async (n: number, locationId = ids.locA) =>
  (await call('POST', '/assets', { session: admin, body: { itemId: ids.item, quantity: n, acquisitionYear: 2026, unitId: ids.unit, locationId } })).body.data as { id: string; code: string }[];
const approve = async (entityId: string, s = approver) => call('POST', `/approvals/${(await db.approvalRequest.findFirstOrThrow({ where: { entityId, status: 'PENDING' } })).id}/approve`, { session: s, body: {} });
const asset = (id: string) => db.asset.findUniqueOrThrow({ where: { id } });

describe('pemeliharaan dan perbaikan', () => {
  it('alur penuh: aset baru tidak tersedia setelah perbaikan dimulai; kembali tersedia dengan kondisi hasil perbaikan', async () => {
    const [a] = await mkAssets(1);
    const m = (await call('POST', '/maintenances', { session: petugas, body: { assetId: a!.id, date: today, type: 'CORRECTIVE', damageDescription: 'Layar mati', performerName: 'Teknisi A' } })).body.data;
    expect(m.number).toMatch(/^PMH-\d{4}-\d{4}$/);
    expect(m.status).toBe('REPORTED');
    expect((await call('POST', `/maintenances/${m.id}/start`, { session: petugas })).status).toBe(422);
    expect((await call('POST', `/maintenances/${m.id}/submit`, { session: petugas })).status).toBe(200);
    expect((await approve(m.id, petugas)).status).toBe(403);
    expect((await approve(m.id)).status).toBe(200);
    // sudah disetujui tetapi belum dikerjakan: aset masih tersedia
    expect((await asset(a!.id)).status).toBe('AVAILABLE');
    expect((await call('POST', `/maintenances/${m.id}/start`, { session: viewer })).status).toBe(403);
    expect((await call('POST', `/maintenances/${m.id}/start`, { session: petugas })).status).toBe(200);
    expect((await asset(a!.id)).status).toBe('UNDER_MAINTENANCE');

    // tidak dapat dipinjam atau dimutasi selama perbaikan
    const loan = await call('POST', '/loans', { session: petugas, body: { borrowerPersonId: ids.person, loanDate: today, expectedReturnDate: today, purpose: 'x', assetIds: [a!.id] } });
    expect(loan.status).toBe(422);
    expect(loan.body.errors[0].message).toMatch(/perbaikan/);
    const mut = await call('POST', '/mutations', { session: petugas, body: { date: today, reason: 'x', lines: [{ assetId: a!.id, toUnitId: ids.unit, toLocationId: ids.locB }] } });
    expect(mut.status).toBe(422);
    // pemeliharaan kedua untuk aset yang sama ditolak
    expect((await call('POST', '/maintenances', { session: petugas, body: { assetId: a!.id, date: today, type: 'PREVENTIVE', damageDescription: 'Cek rutin' } })).status).toBe(422);

    expect((await call('POST', `/maintenances/${m.id}/complete`, { session: petugas, body: { actionTaken: '', resultingCondition: 'GOOD' } })).status).toBe(400);
    const done = await call('POST', `/maintenances/${m.id}/complete`, { session: petugas, body: { actionTaken: 'Ganti panel layar', cost: 1500000, resultingCondition: 'GOOD' } });
    expect(done.status).toBe(200);
    const after = await asset(a!.id);
    expect([after.status, after.condition]).toEqual(['AVAILABLE', 'GOOD']);
    const detail = (await call('GET', `/maintenances/${m.id}`, { session: viewer })).body.data;
    expect(detail).toMatchObject({ status: 'COMPLETED', actionTaken: 'Ganti panel layar', cost: '1500000' });
    const hist = (await call('GET', `/assets/${a!.id}/history`, { session: viewer })).body.data;
    expect(hist.maintenances[0].number).toBe(m.number);
    expect(hist.condition.map((h: any) => h.toStatus)).toEqual(['AVAILABLE', 'UNDER_MAINTENANCE', 'AVAILABLE']);
    expect((await call('GET', '/maintenances?history=true', { session: viewer })).body.data.map((x: any) => x.id)).toContain(m.id);
    expect((await call('POST', `/maintenances/${m.id}/complete`, { session: petugas, body: { actionTaken: 'x', resultingCondition: 'GOOD' } })).status).toBe(422);
  });

  it('aset yang sedang dipinjam tidak dapat mulai diperbaiki; aset dihapuskan tidak dapat dilaporkan; ditolak lalu diperbaiki', async () => {
    const [a, b] = await mkAssets(2);
    await db.asset.update({ where: { id: a!.id }, data: { status: 'LOANED' } });
    const m = (await call('POST', '/maintenances', { session: petugas, body: { assetId: a!.id, date: today, type: 'CORRECTIVE', damageDescription: 'Rusak' } })).body.data;
    await call('POST', `/maintenances/${m.id}/submit`, { session: petugas });
    await approve(m.id);
    const start = await call('POST', `/maintenances/${m.id}/start`, { session: petugas });
    expect(start.status).toBe(409);
    expect((await asset(a!.id)).status).toBe('LOANED');
    expect((await db.maintenance.findUniqueOrThrow({ where: { id: m.id } })).status).toBe('APPROVED');

    await db.asset.update({ where: { id: b!.id }, data: { status: 'DISPOSED' } });
    expect((await call('POST', '/maintenances', { session: petugas, body: { assetId: b!.id, date: today, type: 'CORRECTIVE', damageDescription: 'x' } })).status).toBe(422);

    const [c] = await mkAssets(1);
    const m2 = (await call('POST', '/maintenances', { session: petugas, body: { assetId: c!.id, date: today, type: 'CORRECTIVE', damageDescription: 'Bunyi aneh' } })).body.data;
    await call('POST', `/maintenances/${m2.id}/submit`, { session: petugas });
    const reqId = (await db.approvalRequest.findFirstOrThrow({ where: { entityId: m2.id } })).id;
    expect((await call('POST', `/approvals/${reqId}/reject`, { session: approver, body: { note: 'Belum perlu' } })).status).toBe(200);
    expect((await call('PATCH', `/maintenances/${m2.id}`, { session: petugas, body: { assetId: c!.id, date: today, type: 'CORRECTIVE', damageDescription: 'Bunyi aneh dan panas' } })).status).toBe(200);
    await call('POST', `/maintenances/${m2.id}/submit`, { session: petugas });
    expect((await approve(m2.id, approver2)).status).toBe(200);
    expect((await call('PATCH', `/maintenances/${m2.id}`, { session: petugas, body: { assetId: c!.id, date: today, type: 'CORRECTIVE', damageDescription: 'ubah diam-diam' } })).status).toBe(422);
  });
});

describe('penghapusan aset', () => {
  it('alur penuh: setelah finalisasi aset berstatus dihapuskan, histori utuh, QR tetap menunjukkan identitas, tidak bisa dipakai lagi', async () => {
    const [a, b] = await mkAssets(2);
    const d = (await call('POST', '/disposals', { session: petugas, body: { date: today, reason: 'Rusak berat tidak dapat diperbaiki', method: 'DESTROYED', lines: [{ assetId: a!.id }, { assetId: b!.id, notes: 'Terbakar' }] } })).body.data;
    expect(d.number).toMatch(/^PHP-\d{4}-\d{4}$/);
    expect((await call('POST', `/disposals/${d.id}/complete`, { session: admin })).status).toBe(422);
    await call('POST', `/disposals/${d.id}/submit`, { session: petugas });
    expect((await approve(d.id, petugas)).status).toBe(403);
    expect((await approve(d.id)).status).toBe(200);
    expect((await asset(a!.id)).status).toBe('AVAILABLE'); // persetujuan belum menghapus
    expect((await call('POST', `/disposals/${d.id}/complete`, { session: petugas })).status).toBe(403); // petugas tidak punya disposals.complete
    const done = await call('POST', `/disposals/${d.id}/complete`, { session: admin });
    expect(done.status).toBe(200);
    expect(done.body.data.assets.sort()).toEqual([a!.code, b!.code].sort());

    const row = await asset(a!.id);
    expect(row.status).toBe('DISPOSED');
    expect(row.disposedAt).not.toBeNull();
    expect(await db.asset.count({ where: { id: a!.id } })).toBe(1); // tidak dihapus permanen
    const hist = (await call('GET', `/assets/${a!.id}/history`, { session: viewer })).body.data;
    expect(hist.location).toHaveLength(1);
    expect(hist.condition[0]).toMatchObject({ sourceType: 'DISPOSAL', toStatus: 'DISPOSED' });
    const qr = await call('GET', `/assets/by-code/${a!.code}`, { session: viewer });
    expect(qr.status).toBe(200);
    expect(qr.body.data.status).toBe('DISPOSED');
    expect((await call('GET', `/assets/${a!.id}`, { session: viewer })).status).toBe(200);

    // tidak dapat dipinjam, dimutasi, dipelihara, diedit, atau dihapuskan lagi
    expect((await call('POST', '/loans', { session: petugas, body: { borrowerPersonId: ids.person, loanDate: today, expectedReturnDate: today, purpose: 'x', assetIds: [a!.id] } })).status).toBe(422);
    expect((await call('POST', '/mutations', { session: petugas, body: { date: today, reason: 'x', lines: [{ assetId: a!.id, toUnitId: ids.unit, toLocationId: ids.locB }] } })).status).toBe(422);
    expect((await call('POST', '/maintenances', { session: petugas, body: { assetId: a!.id, date: today, type: 'CORRECTIVE', damageDescription: 'x' } })).status).toBe(422);
    expect((await call('PATCH', `/assets/${a!.id}`, { session: admin, body: { acquisitionYear: 2026, acquisitionCost: 1, condition: 'GOOD' } })).status).toBe(422);
    expect((await call('POST', '/disposals', { session: petugas, body: { date: today, reason: 'lagi', method: 'SOLD', lines: [{ assetId: a!.id }] } })).status).toBe(422);
    expect((await call('GET', '/disposals?history=true', { session: viewer })).body.data.map((x: any) => x.id)).toContain(d.id);
    expect(await db.auditLog.count({ where: { entityId: d.id, action: 'DISPOSAL_COMPLETE' } })).toBe(1);
  });

  it('finalisasi atomik: aset kedua tidak lagi tersedia, aset pertama tetap tidak berubah', async () => {
    const [a, b] = await mkAssets(2);
    const d = (await call('POST', '/disposals', { session: petugas, body: { date: today, reason: 'Atomik', method: 'OTHER', lines: [{ assetId: a!.id }, { assetId: b!.id }] } })).body.data;
    await call('POST', `/disposals/${d.id}/submit`, { session: petugas });
    await approve(d.id);
    await db.asset.update({ where: { id: b!.id }, data: { status: 'LOANED' } });
    const r = await call('POST', `/disposals/${d.id}/complete`, { session: admin });
    expect(r.status).toBe(409);
    expect((await asset(a!.id)).status).toBe('AVAILABLE');
    expect((await asset(b!.id)).status).toBe('LOANED');
    expect((await db.disposal.findUniqueOrThrow({ where: { id: d.id } })).status).toBe('APPROVED');
  });

  it('aset dipinjam/diperbaiki tidak dapat diusulkan; satu aset tidak di dua usulan terbuka; edit setelah disetujui ditolak; pembatalan', async () => {
    const [a, b, c] = await mkAssets(3);
    await db.asset.update({ where: { id: a!.id }, data: { status: 'LOANED' } });
    expect((await call('POST', '/disposals', { session: petugas, body: { date: today, reason: 'x', method: 'SOLD', lines: [{ assetId: a!.id }] } })).status).toBe(422);
    const body = (x: { id: string }) => ({ date: today, reason: 'Usang', method: 'SOLD', lines: [{ assetId: x.id }] });
    const d1 = (await call('POST', '/disposals', { session: petugas, body: body(b!) })).body.data;
    const dup = await call('POST', '/disposals', { session: petugas, body: body(b!) });
    expect(dup.status).toBe(422);
    expect(dup.body.errors[0].message).toMatch(/sudah ada di penghapusan PHP-/);
    await call('POST', `/disposals/${d1.id}/submit`, { session: petugas });
    expect((await call('PATCH', `/disposals/${d1.id}`, { session: petugas, body: body(c!) })).status).toBe(422);
    const reqId = (await db.approvalRequest.findFirstOrThrow({ where: { entityId: d1.id } })).id;
    await call('POST', `/approvals/${reqId}/reject`, { session: approver, body: { note: 'Masih layak' } });
    expect((await call('PATCH', `/disposals/${d1.id}`, { session: petugas, body: body(c!) })).status).toBe(200);
    expect((await call('POST', `/disposals/${d1.id}/cancel`, { session: petugas })).status).toBe(200);
    expect((await asset(c!.id)).status).toBe('AVAILABLE');
    expect((await call('POST', '/disposals', { session: viewer, body: body(c!) })).status).toBe(403);
  });
});

describe('stock opname', () => {
  async function setup(opts: { locationId?: string; n?: number } = {}) {
    const assets = await mkAssets(opts.n ?? 10, opts.locationId ?? ids.locA);
    const o = (await call('POST', '/stock-opnames', { session: admin, body: { title: 'Opname Lantai 1', periodStart: today, periodEnd: today, locationId: opts.locationId ?? ids.locA, assigneeIds: [petugasId] } })).body.data;
    return { assets, o };
  }
  const scan = (opnameId: string, code: string, extra: object = {}, s = petugas) =>
    call('POST', `/stock-opnames/${opnameId}/scan`, { session: s, body: { clientId: crypto.randomUUID(), code, ...extra } });

  it('skenario spesifikasi: 10 aset, 8 sesuai, 1 beda lokasi, 1 tidak ditemukan; master berubah hanya setelah verifikasi', async () => {
    await db.asset.updateMany({ data: { archivedAt: new Date() } }); // isolasi dari aset test lain
    const { assets, o } = await setup();
    expect(o.number).toMatch(/^SOP-\d{4}-\d{4}$/);
    expect((await call('POST', `/stock-opnames/${o.id}/scan`, { session: petugas, body: { clientId: crypto.randomUUID(), code: assets[0]!.code } })).status).toBe(422); // belum dimulai
    expect((await call('POST', `/stock-opnames/${o.id}/start`, { session: petugas })).status).toBe(403);
    const started = await call('POST', `/stock-opnames/${o.id}/start`, { session: admin });
    expect(started.body.data.total).toBe(10);

    expect((await scan(o.id, assets[0]!.code, {}, petugas2)).status).toBe(403); // bukan petugas pemeriksa
    for (const a of assets.slice(0, 8)) {
      const r = await scan(o.id, a.code);
      expect(r.status).toBe(200);
      expect(r.body.data.detail.result).toBe('MATCH');
    }
    const diff = await scan(o.id, assets[8]!.code, { foundLocationId: ids.locB, notes: 'Ditemukan di lantai 2' });
    expect(diff.body.data.detail).toMatchObject({ result: 'MISMATCH', foundLocationId: ids.locB });
    expect(diff.body.data.detail.notes).toMatch(/Lokasi ditemukan berbeda/);

    const premature = await call('POST', `/stock-opnames/${o.id}/submit`, { session: petugas, body: {} });
    expect(premature.status).toBe(422);
    expect(premature.body.errors[0].message).toMatch(/1 aset belum diperiksa/);
    expect((await call('POST', `/stock-opnames/${o.id}/submit`, { session: petugas, body: { markUncheckedAsNotFound: true } })).status).toBe(200);

    const detail = (await call('GET', `/stock-opnames/${o.id}`, { session: viewer })).body.data;
    expect(detail.summary).toEqual({ MATCH: 8, MISMATCH: 1, NOT_FOUND: 1, NOT_CHECKED: 0, UNREGISTERED: 0 });
    expect(detail.status).toBe('SUBMITTED');
    // master belum berubah sebelum verifikasi
    expect((await asset(assets[8]!.id)).locationId).toBe(ids.locA);
    expect((await asset(assets[9]!.id)).status).toBe('AVAILABLE');

    // verifikasi: bukan oleh pembuat/petugas lapangan, harus memutuskan semua temuan
    expect((await call('POST', `/stock-opnames/${o.id}/verify`, { session: admin, body: { decisions: [] } })).status).toBe(403);
    expect((await call('POST', `/stock-opnames/${o.id}/verify`, { session: petugas, body: { decisions: [] } })).status).toBe(403);
    expect((await call('POST', `/stock-opnames/${o.id}/verify`, { session: viewer, body: { decisions: [] } })).status).toBe(403);
    const undecided = await call('POST', `/stock-opnames/${o.id}/verify`, { session: approver, body: { decisions: [] } });
    expect(undecided.status).toBe(422);
    const rows = (await call('GET', `/stock-opnames/${o.id}/details?result=MISMATCH`, { session: viewer })).body.data;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ expectedLocation: 'Lantai 1', foundLocation: 'Lantai 2' });
    const notFound = (await call('GET', `/stock-opnames/${o.id}/details?result=NOT_FOUND`, { session: viewer })).body.data[0];
    const decisions = [{ detailId: rows[0].id, decision: 'APPLY' }, { detailId: notFound.id, decision: 'APPLY' }];
    const ver = await call('POST', `/stock-opnames/${o.id}/verify`, { session: approver, body: { note: 'Sudah dicek ulang', decisions } });
    expect(ver.status).toBe(200);
    expect(ver.body.data).toEqual({ applied: 2, rejected: 0 });
    expect((await asset(assets[8]!.id)).locationId).toBe(ids.locB);
    const missing = await asset(notFound.assetId);
    expect(missing.status).toBe('MISSING');
    const hist = (await call('GET', `/assets/${assets[8]!.id}/history`, { session: viewer })).body.data;
    expect(hist.location[0]).toMatchObject({ sourceType: 'OPNAME', fromLocation: 'Lantai 1', toLocation: 'Lantai 2' });
    expect((await call('GET', `/stock-opnames/${o.id}`, { session: viewer })).body.data.status).toBe('VERIFIED');
    expect((await call('POST', `/stock-opnames/${o.id}/verify`, { session: approver2, body: { decisions } })).status).toBe(422);
    expect(await db.auditLog.count({ where: { entityId: o.id, action: 'OPNAME_VERIFY' } })).toBe(1);
  });

  it('keputusan tolak tidak mengubah master; barang tidak terdaftar dicatat tanpa membuat aset; aset MISSING yang ditemukan dapat dipulihkan', async () => {
    await db.asset.updateMany({ where: { locationId: ids.locB }, data: { archivedAt: new Date() } }); // sisa test sebelumnya
    const { assets, o } = await setup({ locationId: ids.locB, n: 3 });
    await db.asset.update({ where: { id: assets[2]!.id }, data: { status: 'MISSING' } });
    await call('POST', `/stock-opnames/${o.id}/start`, { session: admin });
    await scan(o.id, assets[0]!.code, { foundCondition: 'MAJOR_DAMAGE', notes: 'Pecah' });
    await scan(o.id, assets[2]!.code);
    const unk = await scan(o.id, 'INV-XXX-2026-999999', { notes: 'Laptop tanpa label' });
    expect(unk.body.data.detail).toMatchObject({ result: 'UNREGISTERED', assetId: null });
    expect((await scan(o.id, 'INV-XXX-2026-999999')).body.data.status).toBe('duplicate');
    await call('POST', `/stock-opnames/${o.id}/submit`, { session: petugas, body: { markUncheckedAsNotFound: true } });
    const all = (await call('GET', `/stock-opnames/${o.id}/details?limit=50`, { session: viewer })).body.data;
    const find = (assetId: string | null) => all.find((d: any) => d.assetId === assetId);
    const decisions = [
      { detailId: find(assets[0]!.id).id, decision: 'REJECT' },        // kondisi rusak ditolak
      { detailId: find(assets[1]!.id).id, decision: 'REJECT' },        // tidak ditemukan ditolak
      { detailId: find(assets[2]!.id).id, decision: 'APPLY' },         // MISSING ditemukan -> tersedia
      { detailId: all.find((d: any) => d.result === 'UNREGISTERED').id, decision: 'APPLY' },
    ];
    const assetsBefore = await db.asset.count();
    const verified = await call('POST', `/stock-opnames/${o.id}/verify`, { session: approver, body: { decisions } });
    expect(verified.body).toMatchObject({ success: true });
    expect((await asset(assets[0]!.id)).condition).toBe('GOOD');
    expect((await asset(assets[1]!.id)).status).toBe('AVAILABLE');
    expect((await asset(assets[2]!.id)).status).toBe('AVAILABLE');
    expect(await db.asset.count()).toBe(assetsBefore);
  });

  it('pemindaian idempoten dan sinkronisasi offline: kirim ulang tidak menggandakan; konflik dilaporkan per catatan', async () => {
    const { assets, o } = await setup({ locationId: ids.locChild, n: 3 });
    await call('POST', `/stock-opnames/${o.id}/start`, { session: admin });
    const clientId = crypto.randomUUID();
    const rec = (code: string, id = crypto.randomUUID()) => ({ clientId: id, clientRecordedAt: new Date(Date.now() - 60000).toISOString(), code });
    const first = await call('POST', `/stock-opnames/${o.id}/sync`, { session: petugas, body: { records: [rec(assets[0]!.code, clientId), rec(assets[1]!.code), rec('INV-ZZZ-2026-000000')] } });
    expect(first.body.data).toMatchObject({ accepted: 3, conflicts: 0 });
    const again = await call('POST', `/stock-opnames/${o.id}/sync`, { session: petugas, body: { records: [rec(assets[0]!.code, clientId)] } });
    expect(again.body.data.results[0].status).toBe('duplicate');
    expect(await db.stockOpnameDetail.count({ where: { opnameId: o.id, result: { not: 'NOT_CHECKED' } } })).toBe(3);
    const stored = await db.stockOpnameDetail.findFirstOrThrow({ where: { opnameId: o.id, clientId } });
    expect(stored.clientRecordedAt).not.toBeNull();

    // aset dihapuskan di tengah pemeriksaan: konflik per catatan, yang lain tetap diterima
    await db.asset.update({ where: { id: assets[2]!.id }, data: { status: 'DISPOSED' } });
    const mixed = await call('POST', `/stock-opnames/${o.id}/sync`, { session: petugas, body: { records: [rec(assets[2]!.code), rec(assets[0]!.code)] } });
    expect(mixed.body.data.results.map((r: any) => r.status)).toEqual(['conflict', 'ok']);
    expect(mixed.body.data.results[0].message).toMatch(/dihapuskan/);
    // setelah diajukan, sinkronisasi baru menjadi konflik
    await call('POST', `/stock-opnames/${o.id}/submit`, { session: petugas, body: { markUncheckedAsNotFound: true } });
    const late = await call('POST', `/stock-opnames/${o.id}/sync`, { session: petugas, body: { records: [rec(assets[0]!.code)] } });
    expect(late.body.data).toMatchObject({ accepted: 0, conflicts: 1 });
    expect((await call('POST', `/stock-opnames/${o.id}/sync`, { session: petugas2, body: { records: [rec(assets[0]!.code)] } })).status).toBe(403);
  });

  it('lingkup mencakup lokasi anak; aset terdaftar di luar lingkup dilaporkan tidak sesuai; foto pemeriksaan tersimpan privat', async () => {
    const inChild = await mkAssets(2, ids.locChild);
    const outside = (await mkAssets(1, ids.locB))[0]!;
    const o = (await call('POST', '/stock-opnames', { session: admin, body: { title: 'Lantai 1 + anak', periodStart: today, periodEnd: today, locationId: ids.locA, assigneeIds: [petugasId] } })).body.data;
    await db.asset.updateMany({ where: { id: { notIn: [...inChild.map((a) => a.id), outside.id] }, locationId: { in: [ids.locA, ids.locChild] } }, data: { archivedAt: new Date() } });
    const st = await call('POST', `/stock-opnames/${o.id}/start`, { session: admin });
    expect(st.body.data.total).toBe(2);
    const out = await scan(o.id, outside.code);
    expect(out.body.data.detail).toMatchObject({ result: 'MISMATCH', assetId: outside.id });
    expect(out.body.data.detail.notes).toMatch(/di luar lingkup/);
    const inScan = await scan(o.id, inChild[0]!.code);
    const detailId = inScan.body.data.detail.id;

    const app = await getApp();
    const upload = async (file: Buffer, s: Session) => {
      const boundary = '----t';
      const body = Buffer.concat([Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="bukti.png"\r\nContent-Type: image/png\r\n\r\n`), file, Buffer.from(`\r\n--${boundary}--\r\n`)]);
      const res = await app.inject({ method: 'POST', url: `/api/v1/stock-opnames/${o.id}/details/${detailId}/photos`, payload: body, headers: { cookie: s.cookie, 'x-csrf-token': s.csrf, 'content-type': `multipart/form-data; boundary=${boundary}` } });
      return { status: res.statusCode, body: res.json() };
    };
    expect((await upload(Buffer.from('<script>alert(1)</script>'), petugas)).status).toBe(400);
    expect((await upload(PNG, petugas2)).status).toBe(403);
    const up = await upload(PNG, petugas);
    expect(up.status).toBe(201);
    const listed = (await call('GET', `/stock-opnames/${o.id}/details?search=${inChild[0]!.code}`, { session: viewer })).body.data[0];
    expect(listed.photos).toHaveLength(1);
    const file = await call('GET', `/files/${listed.photos[0].fileId}`, { session: viewer });
    expect(file.status).toBe(200);
    expect((await call('GET', `/files/${listed.photos[0].fileId}`)).status).toBe(401);
    // pembatalan tidak mengubah master
    expect((await call('POST', `/stock-opnames/${o.id}/cancel`, { session: admin })).status).toBe(200);
    expect((await asset(outside.id)).locationId).toBe(ids.locB);
    expect(adminId).toBeTruthy(); void root;
  });
});
