import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { call, seedBase, sessionFor, getApp, type Session } from './app-helpers';
import { db, resetDb } from './helpers';
import { postStockTransaction } from '../src/modules/stocks/service';

let admin: Session, petugas: Session, viewer: Session, adminId: string;
let ids: { cat: string; catAtk: string; uom: string; unit: string; location: string; wh: string; person: string };

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');

async function upload(path: string, session: Session, file: Buffer, filename: string) {
  const app = await getApp();
  const boundary = '----simaTest';
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: image/png\r\n\r\n`),
    file, Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  const res = await app.inject({ method: 'POST', url: `/api/v1${path}`, payload: body, headers: { cookie: session.cookie, 'x-csrf-token': session.csrf, 'content-type': `multipart/form-data; boundary=${boundary}` } });
  return { status: res.statusCode, body: res.json() };
}

beforeAll(async () => {
  await resetDb();
  await seedBase();
  const a = await sessionFor('SUPER_ADMIN');
  admin = a.session;
  adminId = a.user.id;
  petugas = (await sessionFor('PETUGAS_INVENTARIS')).session;
  viewer = (await sessionFor('VIEWER')).session;
  const loc = await db.location.create({ data: { code: 'R-101', name: 'Ruang 101', type: 'ROOM' } });
  const person = await db.person.create({ data: { name: 'Pak Hadi' } });
  ids = {
    cat: (await db.category.findUniqueOrThrow({ where: { code: 'ELK' } })).id,
    catAtk: (await db.category.findUniqueOrThrow({ where: { code: 'ATK' } })).id,
    uom: (await db.unitOfMeasure.findUniqueOrThrow({ where: { code: 'UNIT' } })).id,
    unit: (await db.organizationalUnit.findUniqueOrThrow({ where: { code: 'UNIT-UTAMA' } })).id,
    wh: (await db.warehouse.findUniqueOrThrow({ where: { code: 'GDG-UTAMA' } })).id,
    location: loc.id, person: person.id,
  };
});
afterAll(() => db.$disconnect());

const mkItem = async (type: 'ASSET' | 'SUPPLY', name: string, extra: object = {}) =>
  (await call('POST', '/items', { session: admin, body: { name, type, categoryId: type === 'ASSET' ? ids.cat : ids.catAtk, unitOfMeasureId: ids.uom, ...extra } })).body.data;

describe('master barang', () => {
  it('kode otomatis per jenis dan kategori, tidak ada duplikat', async () => {
    const a = await mkItem('ASSET', 'Laptop Lenovo ThinkPad E14');
    const b = await mkItem('ASSET', 'Printer');
    const s = await mkItem('SUPPLY', 'Kertas A4', { minStock: 10 });
    expect(a.code).toMatch(/^BRG-ELK-\d{6}$/);
    expect(b.code).not.toBe(a.code);
    expect(s.code).toMatch(/^PRS-ATK-\d{6}$/);
  });

  it('validasi dan hak akses', async () => {
    const bad = await call('POST', '/items', { session: admin, body: { name: '', type: 'X', categoryId: 'x', unitOfMeasureId: 'y' } });
    expect(bad.status).toBe(400);
    expect((await call('POST', '/items', { session: viewer, body: { name: 'X', type: 'ASSET', categoryId: ids.cat, unitOfMeasureId: ids.uom } })).status).toBe(403);
    const inactiveCat = await db.category.create({ data: { code: 'OFF', codePrefix: 'OFF', name: 'Off', isActive: false } });
    const r = await call('POST', '/items', { session: admin, body: { name: 'X', type: 'ASSET', categoryId: inactiveCat.id, unitOfMeasureId: ids.uom } });
    expect(r.status).toBe(422);
  });

  it('jenis tidak bisa diubah lewat PATCH; arsip dan aktifkan kembali tercatat audit', async () => {
    const it = await mkItem('ASSET', 'Meja Kerja');
    const upd = await call('PATCH', `/items/${it.id}`, { session: admin, body: { name: 'Meja Kerja Besar', categoryId: ids.cat, unitOfMeasureId: ids.uom, type: 'SUPPLY' } });
    expect(upd.status).toBe(200);
    expect(upd.body.data.type).toBe('ASSET');
    expect((await call('POST', `/items/${it.id}/archive`, { session: admin })).body.data.isActive).toBe(false);
    expect((await call('POST', `/items/${it.id}/archive`, { session: petugas })).status).toBe(403);
    expect((await call('POST', `/items/${it.id}/unarchive`, { session: admin })).body.data.isActive).toBe(true);
    expect(await db.auditLog.count({ where: { entityType: 'Item', entityId: it.id, action: { in: ['ARCHIVE', 'UNARCHIVE', 'UPDATE'] } } })).toBe(3);
  });

  it('daftar mendukung filter jenis, pencarian, dan menampilkan total stok persediaan', async () => {
    const r = await call('GET', '/items?type=SUPPLY&search=kertas', { session: viewer });
    expect(r.body.data).toHaveLength(1);
    expect(r.body.data[0].stockTotal).toBe('0');
    expect((await call('GET', '/items?type=ASSET&limit=2', { session: viewer })).body.meta.limit).toBe(2);
  });
});

describe('aset individual dan QR', () => {
  let itemId: string;
  const base = () => ({ itemId, quantity: 3, acquisitionYear: 2026, unitId: ids.unit, locationId: ids.location, personId: ids.person, acquisitionCost: 12000000 });

  it('mendaftarkan 3 unit: 3 kode berbeda, 3 QR berbeda, histori awal tercatat', async () => {
    itemId = (await mkItem('ASSET', 'Laptop Uji QR')).id;
    const r = await call('POST', '/assets', { session: petugas, body: { ...base(), serialNumbers: ['SN-A', 'SN-B', ''] } });
    expect(r.status).toBe(201);
    const assets = r.body.data as { id: string; code: string; serialNumber: string | null }[];
    expect(assets).toHaveLength(3);
    expect(new Set(assets.map((a) => a.code)).size).toBe(3);
    for (const a of assets) expect(a.code).toMatch(/^INV-ELK-2026-\d{6}$/);
    expect(assets.map((a) => a.serialNumber)).toEqual(['SN-A', 'SN-B', null]);

    const qrs = await Promise.all(assets.map((a) => call('GET', `/assets/${a.id}/qr`, { session: viewer })));
    expect(qrs.every((q) => q.status === 200 && q.res.headers['content-type'] === 'image/png')).toBe(true);
    expect(new Set(qrs.map((q) => q.res.rawPayload.toString('base64'))).size).toBe(3);
    expect((await call('GET', `/assets/${assets[0]!.id}/qr?format=svg`, { session: viewer })).res.body).toContain('<svg');

    const h = await call('GET', `/assets/${assets[0]!.id}/history`, { session: viewer });
    expect(h.body.data.location).toHaveLength(1);
    expect(h.body.data.location[0]).toMatchObject({ sourceType: 'REGISTRATION', toLocation: 'Ruang 101', toPerson: 'Pak Hadi' });
    expect(h.body.data.condition[0]).toMatchObject({ toCondition: 'GOOD', toStatus: 'AVAILABLE' });
    expect(await db.auditLog.count({ where: { entityType: 'Asset', action: 'CREATE' } })).toBeGreaterThanOrEqual(3);
  });

  it('kode tetap unik saat pendaftaran serentak', async () => {
    const results = await Promise.all(Array.from({ length: 6 }, () => call('POST', '/assets', { session: admin, body: { ...base(), quantity: 2 } })));
    expect(results.every((r) => r.status === 201)).toBe(true);
    const codes = results.flatMap((r) => r.body.data.map((a: { code: string }) => a.code));
    expect(new Set(codes).size).toBe(12);
  });

  it('menolak: persediaan, barang diarsipkan, serial ganda/jumlah salah, lokasi nonaktif, tanpa izin', async () => {
    const supply = await mkItem('SUPPLY', 'Tinta');
    expect((await call('POST', '/assets', { session: admin, body: { ...base(), itemId: supply.id } })).status).toBe(422);
    expect((await call('POST', '/assets', { session: admin, body: { ...base(), serialNumbers: ['A'] } })).status).toBe(422);
    expect((await call('POST', '/assets', { session: admin, body: { ...base(), serialNumbers: ['X', 'x', 'Y'] } })).status).toBe(422);
    expect((await call('POST', '/assets', { session: admin, body: { ...base(), quantity: 101 } })).status).toBe(400);
    const off = await db.location.create({ data: { code: 'OFF-1', name: 'Tutup', type: 'ROOM', isActive: false } });
    expect((await call('POST', '/assets', { session: admin, body: { ...base(), locationId: off.id } })).status).toBe(422);
    expect((await call('POST', '/assets', { session: viewer, body: base() })).status).toBe(403);
    // nomor seri sama pada barang yang sama ditolak database
    await call('POST', '/assets', { session: admin, body: { ...base(), quantity: 1, serialNumbers: ['DUP-1'] } });
    const dup = await call('POST', '/assets', { session: admin, body: { ...base(), quantity: 1, serialNumbers: ['DUP-1'] } });
    expect(dup.status).toBe(409);
    expect(dup.body.errors.some((e: { message: string }) => /sudah dipakai/.test(e.message))).toBe(true);
  });

  it('pendaftaran gagal sebagian di tengah transaksi: tidak ada aset tertinggal', async () => {
    const before = await db.asset.count();
    await call('POST', '/assets', { session: admin, body: { ...base(), quantity: 1, serialNumbers: ['ATOM-1'] } });
    // unit ke-2 bentrok serial dengan unit yang sudah ada -> seluruh batch dibatalkan
    const r = await call('POST', '/assets', { session: admin, body: { ...base(), quantity: 3, serialNumbers: ['ATOM-NEW', 'ATOM-1', 'ATOM-NEW-2'] } });
    expect(r.status).toBe(409);
    expect(await db.asset.count()).toBe(before + 1);
    expect(await db.asset.count({ where: { serialNumber: 'ATOM-NEW' } })).toBe(0);
  });

  it('lookup kode QR: terdaftar, tidak dikenal, dan aset dihapuskan tetap menampilkan identitas', async () => {
    const [a] = (await call('POST', '/assets', { session: admin, body: { ...base(), quantity: 1 } })).body.data;
    const found = await call('GET', `/assets/by-code/${encodeURIComponent(a.code.toLowerCase())}`, { session: viewer });
    expect(found.status).toBe(200);
    expect(found.body.data).toMatchObject({ id: a.id, code: a.code });
    const unknown = await call('GET', '/assets/by-code/INV-XXX-2026-999999', { session: viewer });
    expect(unknown.status).toBe(404);
    expect(unknown.body.message).toMatch(/QR Code tidak dikenal/);
    await db.asset.update({ where: { id: a.id }, data: { status: 'DISPOSED', disposedAt: new Date() } });
    expect((await call('GET', `/assets/by-code/${a.code}`, { session: viewer })).body.data.status).toBe('DISPOSED');
    // aset dihapuskan tidak bisa diedit
    expect((await call('PATCH', `/assets/${a.id}`, { session: admin, body: { acquisitionYear: 2026, acquisitionCost: 1, condition: 'GOOD' } })).status).toBe(422);
    expect((await call('GET', '/assets/by-code/x', { session: undefined })).status).toBe(401);
  });

  it('edit: perubahan kondisi wajib beralasan dan masuk histori kondisi + audit; lokasi tidak bisa diubah lewat PATCH', async () => {
    const [a] = (await call('POST', '/assets', { session: admin, body: { ...base(), quantity: 1 } })).body.data;
    const body = { acquisitionYear: 2026, acquisitionCost: 5000, condition: 'MINOR_DAMAGE', locationId: '00000000-0000-4000-8000-000000000000' };
    expect((await call('PATCH', `/assets/${a.id}`, { session: petugas, body })).status).toBe(422);
    const r = await call('PATCH', `/assets/${a.id}`, { session: petugas, body: { ...body, conditionNote: 'Layar retak' } });
    expect(r.status).toBe(200);
    expect(r.body.data.condition).toBe('MINOR_DAMAGE');
    expect(r.body.data.locationId).toBe(ids.location);
    const h = await call('GET', `/assets/${a.id}/history`, { session: viewer });
    expect(h.body.data.condition[0]).toMatchObject({ fromCondition: 'GOOD', toCondition: 'MINOR_DAMAGE', note: 'Layar retak' });
    const audit = await db.auditLog.findFirstOrThrow({ where: { entityType: 'Asset', entityId: a.id, action: 'UPDATE' } });
    expect((audit.before as any).condition).toBe('GOOD');
    expect((audit.after as any).condition).toBe('MINOR_DAMAGE');
  });

  it('daftar aset: filter, pencarian, sort kolom nama barang, dan cetak QR massal', async () => {
    const list = await call('GET', '/assets?search=INV-ELK&limit=5&sortBy=itemName&sortOrder=asc&condition=GOOD', { session: viewer });
    expect(list.status).toBe(200);
    expect(list.body.data.length).toBeGreaterThan(0);
    expect(list.body.meta.total).toBeGreaterThan(5);
    const ids5 = list.body.data.map((a: { id: string }) => a.id);
    expect((await call('POST', '/assets/bulk-qr', { session: viewer, body: { assetIds: ids5 } })).status).toBe(403);
    const labels = await call('POST', '/assets/bulk-qr', { session: petugas, body: { assetIds: ids5 } });
    expect(labels.status).toBe(200);
    expect(labels.body.data).toHaveLength(5);
    expect(labels.body.data[0].qr).toMatch(/^data:image\/png;base64,/);
    expect((await call('POST', '/assets/bulk-qr', { session: petugas, body: { assetIds: [] } })).status).toBe(400);
  });

  it('pembatasan akses unit: pengguna dengan user_unit_access hanya melihat unitnya', async () => {
    const other = await db.organizationalUnit.create({ data: { code: 'U-LAIN', name: 'Unit Lain', organizationId: (await db.organization.findFirstOrThrow()).id } });
    const [mine] = (await call('POST', '/assets', { session: admin, body: { ...base(), quantity: 1, unitId: other.id } })).body.data;
    const scoped = await sessionFor('PETUGAS_INVENTARIS');
    await db.userUnitAccess.create({ data: { userId: scoped.user.id, unitId: ids.unit } });
    expect((await call('GET', `/assets/${mine.id}`, { session: scoped.session })).status).toBe(403);
    expect((await call('GET', `/assets/by-code/${mine.code}`, { session: scoped.session })).status).toBe(403);
    expect((await call('POST', '/assets', { session: scoped.session, body: { ...base(), unitId: other.id } })).status).toBe(403);
    const list = await call('GET', '/assets?limit=100', { session: scoped.session });
    expect(list.body.data.every((a: { unit: { id: string } }) => a.unit.id === ids.unit)).toBe(true);
    // filter unit eksplisit tidak boleh memperluas akses
    const widen = await call('GET', `/assets?unitId=${other.id}`, { session: scoped.session });
    expect(widen.body.data).toHaveLength(0);
  });
});

describe('upload foto aset dan file privat', () => {
  it('menerima PNG asli, menolak file berbahaya yang menyamar, menyajikan hanya lewat endpoint terautentikasi', async () => {
    const itemId = (await mkItem('ASSET', 'Kamera')).id;
    const [asset] = (await call('POST', '/assets', { session: admin, body: { itemId, quantity: 1, acquisitionYear: 2026, unitId: ids.unit, locationId: ids.location } })).body.data;

    const exe = await upload(`/assets/${asset.id}/photos`, admin, Buffer.from('MZ\x90\x00<script>alert(1)</script>'), 'foto.png');
    expect(exe.status).toBe(400);
    expect(exe.body.message).toMatch(/tidak diizinkan/);
    const html = await upload(`/assets/${asset.id}/photos`, admin, Buffer.from('<html><script>alert(1)</script></html>'), 'x.jpg');
    expect(html.status).toBe(400);

    const ok = await upload(`/assets/${asset.id}/photos`, petugas, PNG, '../../etc/passwd.png');
    expect(ok.status).toBe(201);
    expect(ok.body.data.isPrimary).toBe(true);
    const file = await db.file.findFirstOrThrow({ where: { id: ok.body.data.fileId } });
    expect(file.mimeType).toBe('image/png');
    expect(file.storageKey).toMatch(/^\d{4}\/\d{2}\/[0-9a-f-]{36}\.png$/);
    expect(file.originalName).not.toContain('/');

    const served = await call('GET', `/files/${file.id}`, { session: viewer });
    expect(served.status).toBe(200);
    expect(served.res.headers['content-type']).toBe('image/png');
    expect(served.res.headers['x-content-type-options']).toBe('nosniff');
    expect(Buffer.compare(served.res.rawPayload, PNG)).toBe(0);
    expect((await call('GET', `/files/${file.id}`)).status).toBe(401);

    expect((await upload(`/assets/${asset.id}/photos`, viewer, PNG, 'a.png')).status).toBe(403);
    const second = await upload(`/assets/${asset.id}/photos`, admin, PNG, 'b.png');
    expect(second.body.data.isPrimary).toBe(false);
    expect((await call('POST', `/assets/${asset.id}/photos/${second.body.data.id}/primary`, { session: admin })).status).toBe(200);
    expect((await call('DELETE', `/assets/${asset.id}/photos/${second.body.data.id}`, { session: admin })).status).toBe(200);
    const detail = await call('GET', `/assets/${asset.id}`, { session: viewer });
    expect(detail.body.data.photos).toHaveLength(1);
  });

  it('menolak file lebih besar dari batas', async () => {
    const itemId = (await mkItem('ASSET', 'Proyektor')).id;
    const [asset] = (await call('POST', '/assets', { session: admin, body: { itemId, quantity: 1, acquisitionYear: 2026, unitId: ids.unit, locationId: ids.location } })).body.data;
    const big = Buffer.concat([PNG, Buffer.alloc(11 * 1024 * 1024)]);
    expect((await upload(`/assets/${asset.id}/photos`, admin, big, 'besar.png')).status).toBe(413);
  });
});

describe('persediaan dan stock ledger', () => {
  const today = new Date().toISOString().slice(0, 10);
  const post = (type: 'IN' | 'OUT', itemId: string, quantity: number, session = admin, extra: object = {}) =>
    call('POST', type === 'IN' ? '/stocks/in' : '/stocks/out', { session, body: { warehouseId: ids.wh, date: today, lines: [{ itemId, quantity }], ...extra } });
  const balance = async (itemId: string) => (await db.stockBalance.findUnique({ where: { itemId_warehouseId: { itemId, warehouseId: ids.wh } } }))?.quantity.toString() ?? '0';

  it('skenario spesifikasi: saldo awal 100, masuk 50, keluar 20 = 130; ledger dan kartu stok konsisten', async () => {
    const item = await mkItem('SUPPLY', 'Kertas HVS Uji', { minStock: 150 });
    await db.$transaction((tx) => postStockTransaction(tx, null, { type: 'OPENING', date: new Date(today), warehouseId: ids.wh, lines: [{ itemId: item.id, delta: 100 }], userId: adminId }));
    expect((await post('IN', item.id, 50, petugas)).status).toBe(201);
    const out = await post('OUT', item.id, 20, petugas, { personId: ids.person, notes: 'Penggunaan TU' });
    expect(out.status).toBe(201);
    expect(out.body.data.balances[0]).toMatchObject({ before: '150', after: '130' });
    expect(await balance(item.id)).toBe('130');

    const card = await call('GET', `/stocks/${item.id}/card?warehouseId=${ids.wh}`, { session: viewer });
    expect(card.status).toBe(200);
    expect(card.body.data.map((r: any) => [r.type, r.in, r.out, r.balance])).toEqual([
      ['OPENING', '100', '0', '100'], ['IN', '50', '0', '150'], ['OUT', '0', '20', '130'],
    ]);
    expect(card.body.openingBalance).toBe('0');
    // saldo = jumlah masuk - jumlah keluar dari ledger
    const [sumRow] = await db.$queryRaw<{ s: string }[]>`SELECT SUM("quantityIn" - "quantityOut")::text AS s FROM stock_transaction_details WHERE "itemId" = ${item.id}::uuid`;
    expect(Number(sumRow!.s)).toBe(130);
    // stok 130 < minimum 150 -> muncul di filter stok menipis
    const low = await call('GET', '/stocks?belowMin=true', { session: viewer });
    expect(low.body.data.map((r: any) => r.item.id)).toContain(item.id);
    expect(low.body.data.find((r: any) => r.item.id === item.id)).toMatchObject({ quantity: '130', belowMin: true });
    const detail = await call('GET', `/stocks/${item.id}`, { session: viewer });
    expect(detail.body.data.balances).toEqual([{ warehouseId: ids.wh, warehouse: 'Gudang Utama', quantity: '130' }]);
    const hist = await call('GET', `/stocks/transactions?type=OUT&itemId=${item.id}`, { session: viewer });
    expect(hist.body.data[0]).toMatchObject({ type: 'OUT', person: 'Pak Hadi', notes: 'Penggunaan TU' });
    expect(hist.body.data[0].number).toMatch(/^BK-\d{4}-\d{4}$/);
  });

  it('stok tidak boleh negatif: keluar 15 dari saldo 10 ditolak, saldo dan ledger tidak berubah', async () => {
    const item = await mkItem('SUPPLY', 'Pulpen Uji');
    await post('IN', item.id, 10);
    const ledgerBefore = await db.stockTransactionDetail.count({ where: { itemId: item.id } });
    const txBefore = await db.stockTransaction.count();
    const r = await post('OUT', item.id, 15);
    expect(r.status).toBe(422);
    expect(r.body.errors[0]).toMatchObject({ field: 'lines.0.quantity' });
    expect(r.body.errors[0].message).toMatch(/Tersedia 10, diminta 15/);
    expect(await balance(item.id)).toBe('10');
    expect(await db.stockTransactionDetail.count({ where: { itemId: item.id } })).toBe(ledgerBefore);
    expect(await db.stockTransaction.count()).toBe(txBefore);
    expect((await post('OUT', item.id, 10)).status).toBe(201);
    expect(await balance(item.id)).toBe('0');
  });

  it('atomik: transaksi multi-baris yang gagal di baris ke-2 membatalkan baris ke-1 dan nomor dokumen', async () => {
    const a = await mkItem('SUPPLY', 'Map Uji');
    const b = await mkItem('SUPPLY', 'Lakban Uji');
    await post('IN', a.id, 5);
    await post('IN', b.id, 1);
    const txBefore = await db.stockTransaction.count();
    const r = await call('POST', '/stocks/out', { session: admin, body: { warehouseId: ids.wh, date: today, lines: [{ itemId: a.id, quantity: 3 }, { itemId: b.id, quantity: 9 }] } });
    expect(r.status).toBe(422);
    expect(await balance(a.id)).toBe('5');
    expect(await balance(b.id)).toBe('1');
    expect(await db.stockTransaction.count()).toBe(txBefore);
    expect(await db.auditLog.count({ where: { action: 'STOCK_OUT', after: { path: ['lines'], array_contains: [{ itemId: a.id }] } } })).toBe(0);
  });

  it('pengeluaran serentak: saldo 20, dua permintaan keluar 15, hanya satu berhasil', async () => {
    const item = await mkItem('SUPPLY', 'Tinta Uji');
    await post('IN', item.id, 20);
    const [x, y] = await Promise.all([post('OUT', item.id, 15), post('OUT', item.id, 15)]);
    expect([x.status, y.status].sort()).toEqual([201, 422]);
    expect(await balance(item.id)).toBe('5');
    const many = await Promise.all(Array.from({ length: 10 }, () => post('OUT', item.id, 1)));
    expect(many.filter((m) => m.status === 201)).toHaveLength(5);
    expect(await balance(item.id)).toBe('0');
    const nums = (await db.stockTransaction.findMany({ select: { number: true } })).map((t) => t.number);
    expect(new Set(nums).size).toBe(nums.length);
  });

  it('aturan: hanya persediaan, barang diarsipkan ditolak, kuantitas desimal, gudang nonaktif, baris ganda', async () => {
    const asset = await mkItem('ASSET', 'Kursi Uji');
    expect((await post('IN', asset.id, 1)).status).toBe(422);
    const s = await mkItem('SUPPLY', 'Cairan Uji');
    expect((await post('IN', s.id, 2.5)).status).toBe(201);
    expect(await balance(s.id)).toBe('2.5');
    expect((await post('IN', s.id, 0)).status).toBe(400);
    expect((await post('IN', s.id, -3)).status).toBe(400);
    await call('POST', `/items/${s.id}/archive`, { session: admin });
    expect((await post('IN', s.id, 1)).status).toBe(422);
    const off = await db.warehouse.create({ data: { code: 'OFF-W', name: 'Tutup', isActive: false } });
    const live = await mkItem('SUPPLY', 'Sabun Uji');
    expect((await call('POST', '/stocks/in', { session: admin, body: { warehouseId: off.id, date: today, lines: [{ itemId: live.id, quantity: 1 }] } })).status).toBe(422);
    const dup = await call('POST', '/stocks/in', { session: admin, body: { warehouseId: ids.wh, date: today, lines: [{ itemId: live.id, quantity: 1 }, { itemId: live.id, quantity: 1 }] } });
    expect(dup.status).toBe(400);
  });

  it('hak akses: viewer tidak dapat mencatat; petugas boleh; ledger tidak bisa dimanipulasi lewat API', async () => {
    const item = await mkItem('SUPPLY', 'Spidol Uji');
    expect((await post('IN', item.id, 5, viewer)).status).toBe(403);
    expect((await post('IN', item.id, 5, petugas)).status).toBe(201);
    expect((await call('PATCH', '/stocks/in', { session: admin, body: {} })).status).toBe(404);
    expect((await call('DELETE', '/stocks/transactions', { session: admin })).status).toBe(404);
    const line = await db.stockTransactionDetail.findFirstOrThrow({ where: { itemId: item.id } });
    await expect(db.stockTransactionDetail.update({ where: { id: line.id }, data: { quantityIn: 999 } })).rejects.toThrow(/append-only/);
  });

  it('kartu stok per periode menghitung saldo pembuka', async () => {
    const item = await mkItem('SUPPLY', 'Stapler Uji');
    await post('IN', item.id, 10);
    const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
    const card = await call('GET', `/stocks/${item.id}/card?warehouseId=${ids.wh}&from=${tomorrow}`, { session: viewer });
    expect(card.body.data).toHaveLength(0);
    expect(card.body.openingBalance).toBe('10');
    expect((await call('GET', `/stocks/${item.id}/card`, { session: viewer })).status).toBe(422);
  });
});
