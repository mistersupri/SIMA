import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { call, login, makeUser, seedBase, sessionFor, type Session } from './app-helpers';
import { db, resetDb } from './helpers';

let petugas: Session, petugasId: string, admin: Session, approver: Session, approverId: string, approver2: Session, viewer: Session, root: Session, rootId: string;
let laptop: { id: string }, paper: { id: string };
let ids: { vendor: string; unit: string; location: string; wh: string };
const today = new Date().toISOString().slice(0, 10);

beforeAll(async () => {
  await resetDb();
  await seedBase();
  const p = await sessionFor('PETUGAS_INVENTARIS'); petugas = p.session; petugasId = p.user.id;
  admin = (await sessionFor('ADMIN_INVENTARIS')).session;
  const a = await sessionFor('APPROVER'); approver = a.session; approverId = a.user.id;
  approver2 = (await sessionFor('APPROVER')).session;
  viewer = (await sessionFor('VIEWER')).session;
  const r = await sessionFor('SUPER_ADMIN'); root = r.session; rootId = r.user.id;
  const cat = await db.category.findUniqueOrThrow({ where: { code: 'ELK' } });
  const atk = await db.category.findUniqueOrThrow({ where: { code: 'ATK' } });
  const uom = await db.unitOfMeasure.findUniqueOrThrow({ where: { code: 'UNIT' } });
  laptop = (await call('POST', '/items', { session: admin, body: { name: 'Laptop', type: 'ASSET', categoryId: cat.id, unitOfMeasureId: uom.id } })).body.data;
  paper = (await call('POST', '/items', { session: admin, body: { name: 'Kertas', type: 'SUPPLY', categoryId: atk.id, unitOfMeasureId: uom.id } })).body.data;
  ids = {
    vendor: (await db.vendor.create({ data: { code: 'V1', name: 'PT Maju Jaya' } })).id,
    unit: (await db.organizationalUnit.findUniqueOrThrow({ where: { code: 'UNIT-UTAMA' } })).id,
    location: (await db.location.create({ data: { code: 'GD-1', name: 'Gudang Barang', type: 'ROOM' } })).id,
    wh: (await db.warehouse.findUniqueOrThrow({ where: { code: 'GDG-UTAMA' } })).id,
  };
});
afterAll(() => db.$disconnect());

const body = () => ({ date: today, fiscalYear: 2026, vendorId: ids.vendor, notes: 'Pengadaan uji', lines: [{ itemId: laptop.id, quantity: 3, unitPrice: 10000000 }, { itemId: paper.id, quantity: 100, unitPrice: 50000 }] });
const mk = async (s = petugas) => (await call('POST', '/procurements', { session: s, body: body() })).body.data;
const submitAndGet = async (id: string, s = petugas) => { await call('POST', `/procurements/${id}/submit`, { session: s }); return (await db.approvalRequest.findFirstOrThrow({ where: { entityId: id }, orderBy: { submittedAt: 'desc' } })).id; };
const receiptBody = (lines: object[]) => ({ receivedDate: today, assetUnitId: ids.unit, assetLocationId: ids.location, warehouseId: ids.wh, lines });

describe('pengadaan dan approval', () => {
  it('alur penuh: draft, ajukan, setujui, terima sebagian, konfirmasi, selesai; inventaris baru lahir hanya setelah konfirmasi', async () => {
    const p = await mk();
    expect(p.status).toBe('DRAFT');
    expect(p.number).toMatch(/^PGD-\d{4}-\d{4}$/);
    expect(p.totalAmount).toBe('35000000');
    expect((await call('POST', `/procurements/${p.id}/receive`, { session: petugas, body: receiptBody([]) })).status).toBe(400);

    expect((await call('POST', `/procurements/${p.id}/submit`, { session: viewer })).status).toBe(403);
    const requestId = await submitAndGet(p.id);
    expect((await call('GET', `/procurements/${p.id}`, { session: viewer })).body.data.status).toBe('PENDING_APPROVAL');
    // belum bisa menerima barang sebelum disetujui
    const early = await call('POST', `/procurements/${p.id}/receive`, { session: petugas, body: receiptBody([{ procurementDetailId: p.details[0].id, quantityReceived: 1 }]) });
    expect(early.status).toBe(422);
    // dokumen yang diajukan tidak bisa diedit langsung
    expect((await call('PATCH', `/procurements/${p.id}`, { session: petugas, body: body() })).status).toBe(422);

    // pembuat tidak dapat menyetujui sendiri, role tanpa izin juga ditolak
    expect((await call('POST', `/approvals/${requestId}/approve`, { session: petugas, body: {} })).status).toBe(403);
    expect((await call('POST', `/approvals/${requestId}/approve`, { session: viewer, body: {} })).status).toBe(403);
    expect((await call('POST', `/approvals/${requestId}/approve`, { session: admin, body: {} })).status).toBe(403);
    expect((await call('GET', `/procurements/${p.id}`, { session: viewer })).body.data.status).toBe('PENDING_APPROVAL');

    const ok = await call('POST', `/approvals/${requestId}/approve`, { session: approver, body: { note: 'Sesuai anggaran' } });
    expect(ok.status).toBe(200);
    const detail = (await call('GET', `/procurements/${p.id}`, { session: viewer })).body.data;
    expect(detail.status).toBe('APPROVED');
    expect(detail.approval.steps[0]).toMatchObject({ status: 'APPROVED', actedBy: 'Uji APPROVER', note: 'Sesuai anggaran' });
    expect(await db.asset.count()).toBe(0);
    expect(await db.stockBalance.count()).toBe(0);
    expect((await call('POST', `/approvals/${requestId}/approve`, { session: approver2, body: {} })).status).toBe(409);

    // penerimaan sebagian: 2 laptop + 40 kertas
    const [dl, dp] = [detail.details.find((d: any) => d.item.name === 'Laptop'), detail.details.find((d: any) => d.item.name === 'Kertas')];
    const over = await call('POST', `/procurements/${p.id}/receive`, { session: petugas, body: receiptBody([{ procurementDetailId: dl.id, quantityReceived: 4 }]) });
    expect(over.status).toBe(422);
    const badSerial = await call('POST', `/procurements/${p.id}/receive`, { session: petugas, body: receiptBody([{ procurementDetailId: dl.id, quantityReceived: 2, serialNumbers: ['A'] }]) });
    expect(badSerial.status).toBe(422);
    const noLoc = await call('POST', `/procurements/${p.id}/receive`, { session: petugas, body: { ...receiptBody([{ procurementDetailId: dl.id, quantityReceived: 2 }]), assetLocationId: null } });
    expect(noLoc.status).toBe(422);
    const r1 = await call('POST', `/procurements/${p.id}/receive`, { session: petugas, body: receiptBody([{ procurementDetailId: dl.id, quantityReceived: 2, serialNumbers: ['SN-1', 'SN-2'] }, { procurementDetailId: dp.id, quantityReceived: 40 }]) });
    expect(r1.status).toBe(201);
    expect(r1.body.data.number).toMatch(/^TRM-\d{4}-\d{4}$/);
    expect(await db.asset.count()).toBe(0);
    // verifikasi oleh petugas yang sama ditolak; oleh admin diterima
    expect((await call('POST', `/goods-receipts/${r1.body.data.id}/confirm`, { session: petugas })).status).toBe(403);
    expect((await call('POST', `/goods-receipts/${r1.body.data.id}/confirm`, { session: viewer })).status).toBe(403);
    const c1 = await call('POST', `/goods-receipts/${r1.body.data.id}/confirm`, { session: admin });
    expect(c1.status).toBe(200);
    expect(c1.body.data.assets).toHaveLength(2);
    expect(await db.asset.count()).toBe(2);
    const assets = await db.asset.findMany({ orderBy: { code: 'asc' } });
    expect(assets.map((a) => a.serialNumber)).toEqual(['SN-1', 'SN-2']);
    expect(assets.every((a) => a.acquisitionCost.toString() === '10000000' && a.vendorId === ids.vendor && a.locationId === ids.location)).toBe(true);
    expect((await db.stockBalance.findFirstOrThrow({ where: { itemId: paper.id } })).quantity.toString()).toBe('40');
    expect((await call('GET', `/procurements/${p.id}`, { session: viewer })).body.data.status).toBe('PARTIALLY_RECEIVED');
    expect((await call('POST', `/goods-receipts/${r1.body.data.id}/confirm`, { session: admin })).status).toBe(422);

    // sisa: 1 laptop + 60 kertas, lalu selesai; sisa sudah habis -> ditolak
    const r2 = await call('POST', `/procurements/${p.id}/receive`, { session: petugas, body: receiptBody([{ procurementDetailId: dl.id, quantityReceived: 1 }, { procurementDetailId: dp.id, quantityReceived: 60 }]) });
    expect((await call('POST', `/goods-receipts/${r2.body.data.id}/confirm`, { session: root })).status).toBe(200);
    const done = (await call('GET', `/procurements/${p.id}`, { session: viewer })).body.data;
    expect(done.status).toBe('COMPLETED');
    expect(done.details.map((d: any) => d.receivedQty).sort()).toEqual(['100', '3']);
    expect(new Set((await db.asset.findMany()).map((a) => a.code)).size).toBe(3);
    expect((await db.stockBalance.findFirstOrThrow({ where: { itemId: paper.id } })).quantity.toString()).toBe('100');
    expect((await call('POST', `/procurements/${p.id}/receive`, { session: petugas, body: receiptBody([{ procurementDetailId: dl.id, quantityReceived: 1 }]) })).status).toBe(422);

    // jejak audit lengkap
    const actions = (await db.auditLog.findMany({ where: { entityId: p.id }, orderBy: { createdAt: 'asc' } })).map((a) => a.action);
    expect(actions).toEqual(expect.arrayContaining(['CREATE', 'APPROVAL_SUBMIT', 'STATUS_CHANGE', 'APPROVE']));
    expect(await db.auditLog.count({ where: { action: 'RECEIPT_CONFIRM' } })).toBe(2);
  });

  it('penolakan wajib beralasan; dokumen ditolak dapat diperbaiki dan diajukan ulang', async () => {
    const p = await mk();
    const req1 = await submitAndGet(p.id);
    const noNote = await call('POST', `/approvals/${req1}/reject`, { session: approver, body: {} });
    expect(noNote.status).toBe(400);
    expect((await call('POST', `/approvals/${req1}/reject`, { session: approver, body: { note: 'Harga terlalu tinggi' } })).status).toBe(200);
    const rejected = (await call('GET', `/procurements/${p.id}`, { session: viewer })).body.data;
    expect(rejected.status).toBe('REJECTED');
    expect(rejected.approval.steps[0].note).toBe('Harga terlalu tinggi');
    // perbaiki lalu ajukan ulang
    const fixed = { ...body(), lines: [{ itemId: laptop.id, quantity: 3, unitPrice: 8000000 }] };
    const upd = await call('PATCH', `/procurements/${p.id}`, { session: petugas, body: fixed });
    expect(upd.status).toBe(200);
    expect(upd.body.data).toMatchObject({ status: 'DRAFT', totalAmount: '24000000' });
    const req2 = await submitAndGet(p.id);
    expect(req2).not.toBe(req1);
    expect((await call('POST', `/approvals/${req2}/approve`, { session: approver2, body: {} })).status).toBe(200);
    expect((await call('GET', `/procurements/${p.id}`, { session: viewer })).body.data.status).toBe('APPROVED');
    // keputusan yang sudah final tidak dapat diubah
    expect((await call('POST', `/approvals/${req1}/approve`, { session: approver, body: {} })).status).toBe(409);
  });

  it('pembuat (Super Admin sekalipun) tidak dapat menyetujui dokumennya sendiri', async () => {
    const p = await mk(root);
    const reqId = await submitAndGet(p.id, root);
    const r = await call('POST', `/approvals/${reqId}/approve`, { session: root, body: {} });
    expect(r.status).toBe(403);
    expect(r.body.message).toMatch(/buat sendiri/);
    expect((await call('POST', `/approvals/${reqId}/reject`, { session: root, body: { note: 'x' } })).status).toBe(403);
    expect((await db.procurement.findUniqueOrThrow({ where: { id: p.id } })).status).toBe('PENDING_APPROVAL');
    // approver lain boleh
    expect((await call('POST', `/approvals/${reqId}/approve`, { session: approver, body: {} })).status).toBe(200);
  });

  it('pengaju bukan pembuat pun tidak boleh memutuskan (petugas membuat, admin mengajukan)', async () => {
    const adminUser = await sessionFor('ADMIN_INVENTARIS');
    const p = await mk(petugas);
    await call('POST', `/procurements/${p.id}/submit`, { session: adminUser.session });
    const reqId = (await db.approvalRequest.findFirstOrThrow({ where: { entityId: p.id } })).id;
    const creatorRole = await db.role.findUniqueOrThrow({ where: { code: 'APPROVER' } });
    await db.userRole.create({ data: { userId: petugasId, roleId: creatorRole.id } });
    const petugasAsApprover = await login((await db.user.findUniqueOrThrow({ where: { id: petugasId } })).email, 'Sandi-Uji-12345');
    expect((await call('POST', `/approvals/${reqId}/approve`, { session: petugasAsApprover, body: {} })).status).toBe(403);
    await db.userRole.delete({ where: { userId_roleId: { userId: petugasId, roleId: creatorRole.id } } });
  });

  it('persetujuan serentak: dua approver menyetujui bersamaan, hanya satu yang dicatat', async () => {
    const p = await mk();
    const reqId = await submitAndGet(p.id);
    const [a, b] = await Promise.all([call('POST', `/approvals/${reqId}/approve`, { session: approver, body: {} }), call('POST', `/approvals/${reqId}/approve`, { session: approver2, body: {} })]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    expect(await db.approvalAction.count({ where: { requestId: reqId, action: 'APPROVE' } })).toBe(1);
  });

  it('konfirmasi penerimaan atomik: gagal di baris kedua tidak meninggalkan aset atau saldo', async () => {
    const p = await mk();
    const reqId = await submitAndGet(p.id);
    await call('POST', `/approvals/${reqId}/approve`, { session: approver, body: {} });
    const detail = (await call('GET', `/procurements/${p.id}`, { session: viewer })).body.data;
    const dl = detail.details.find((d: any) => d.item.name === 'Laptop'), dp = detail.details.find((d: any) => d.item.name === 'Kertas');
    const r = await call('POST', `/procurements/${p.id}/receive`, { session: petugas, body: receiptBody([{ procurementDetailId: dl.id, quantityReceived: 3 }, { procurementDetailId: dp.id, quantityReceived: 10 }]) });
    expect(r.status).toBe(201);
    const assetsBefore = await db.asset.count();
    const stockBefore = await db.stockTransaction.count();
    await call('POST', `/items/${paper.id}/archive`, { session: admin });
    const c = await call('POST', `/goods-receipts/${r.body.data.id}/confirm`, { session: admin });
    expect(c.status).toBe(422);
    expect(await db.asset.count()).toBe(assetsBefore);
    expect(await db.stockTransaction.count()).toBe(stockBefore);
    expect((await db.goodsReceipt.findUniqueOrThrow({ where: { id: r.body.data.id } })).status).toBe('DRAFT');
    expect((await db.procurementDetail.findUniqueOrThrow({ where: { id: dl.id } })).receivedQty.toString()).toBe('0');
    await call('POST', `/items/${paper.id}/unarchive`, { session: admin });
    expect((await call('POST', `/goods-receipts/${r.body.data.id}/confirm`, { session: admin })).status).toBe(200);
  });

  it('validasi pengadaan: barang ganda, jumlah aset desimal, vendor nonaktif, tanpa baris', async () => {
    expect((await call('POST', '/procurements', { session: petugas, body: { ...body(), lines: [] } })).status).toBe(400);
    expect((await call('POST', '/procurements', { session: petugas, body: { ...body(), lines: [{ itemId: laptop.id, quantity: 1, unitPrice: 1 }, { itemId: laptop.id, quantity: 1, unitPrice: 1 }] } })).status).toBe(400);
    expect((await call('POST', '/procurements', { session: petugas, body: { ...body(), lines: [{ itemId: laptop.id, quantity: 1.5, unitPrice: 1 }] } })).status).toBe(422);
    expect((await call('POST', '/procurements', { session: petugas, body: { ...body(), lines: [{ itemId: paper.id, quantity: 1.5, unitPrice: 1 }] } })).status).toBe(201);
    const off = await db.vendor.create({ data: { code: 'OFF', name: 'Tutup', isActive: false } });
    expect((await call('POST', '/procurements', { session: petugas, body: { ...body(), vendorId: off.id } })).status).toBe(422);
    expect((await call('POST', '/procurements', { session: viewer, body: body() })).status).toBe(403);
  });
});

describe('daftar persetujuan dan notifikasi', () => {
  it('daftar tunggu hanya memuat yang berwenang dan bukan milik sendiri; riwayat memuat yang final', async () => {
    const p = await mk();
    const reqId = await submitAndGet(p.id);
    const mineApprover = await call('GET', '/approvals', { session: approver });
    expect(mineApprover.body.data.map((r: any) => r.id)).toContain(reqId);
    expect(mineApprover.body.data.find((r: any) => r.id === reqId)).toMatchObject({ entityType: 'PROCUREMENT', canDecide: true, path: `/pengadaan/${p.id}` });
    expect((await call('GET', '/approvals', { session: petugas })).body.data.map((r: any) => r.id)).not.toContain(reqId);
    expect((await call('GET', '/approvals', { session: viewer })).body.data.map((r: any) => r.id)).not.toContain(reqId);
    const all = await call('GET', '/approvals?scope=all&status=PENDING', { session: viewer });
    expect(all.body.data.find((r: any) => r.id === reqId).canDecide).toBe(false);
    await call('POST', `/approvals/${reqId}/approve`, { session: approver, body: {} });
    expect((await call('GET', '/approvals', { session: approver2 })).body.data.map((r: any) => r.id)).not.toContain(reqId);
    expect((await call('GET', '/approvals/history', { session: viewer })).body.data.map((r: any) => r.id)).toContain(reqId);
    const det = await call('GET', `/approvals/${reqId}`, { session: viewer });
    expect(det.body.data.actions.map((a: any) => a.action)).toEqual(['SUBMIT', 'APPROVE']);
  });

  it('notifikasi: approver diberi tahu saat diajukan, pembuat saat diputuskan; bersifat pribadi', async () => {
    const fresh = await sessionFor('APPROVER');
    const maker = await sessionFor('PETUGAS_INVENTARIS');
    const p = (await call('POST', '/procurements', { session: maker.session, body: body() })).body.data;
    await call('POST', `/procurements/${p.id}/submit`, { session: maker.session });
    const count = await call('GET', '/notifications/unread-count', { session: fresh.session });
    expect(count.body.data.count).toBeGreaterThanOrEqual(1);
    const list = await call('GET', '/notifications?unread=true', { session: fresh.session });
    const n = list.body.data.find((x: any) => x.entityId === p.id);
    expect(n).toMatchObject({ type: 'approval.requested', entityType: 'PROCUREMENT' });
    // pembuat tidak menerima notifikasi untuk pengajuannya sendiri
    expect((await call('GET', '/notifications', { session: maker.session })).body.data.some((x: any) => x.entityId === p.id)).toBe(false);
    // notifikasi milik orang lain tidak dapat ditandai
    expect((await call('POST', `/notifications/${n.id}/read`, { session: maker.session })).status).toBe(404);
    expect((await call('POST', `/notifications/${n.id}/read`, { session: fresh.session })).status).toBe(200);
    expect((await call('GET', '/notifications/unread-count', { session: fresh.session })).body.data.count).toBe(count.body.data.count - 1);

    const reqId = (await db.approvalRequest.findFirstOrThrow({ where: { entityId: p.id } })).id;
    await call('POST', `/approvals/${reqId}/reject`, { session: fresh.session, body: { note: 'Belum sesuai' } });
    const back = await call('GET', '/notifications?unread=true', { session: maker.session });
    expect(back.body.data.find((x: any) => x.entityId === p.id)).toMatchObject({ type: 'approval.rejected', body: 'Belum sesuai' });
    expect((await call('POST', '/notifications/read-all', { session: maker.session })).body.data.updated).toBeGreaterThanOrEqual(1);
    expect((await call('GET', '/notifications/unread-count', { session: maker.session })).body.data.count).toBe(0);
    void approverId; void rootId;
  });
});
