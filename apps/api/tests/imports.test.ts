import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import { call, getApp, seedBase, sessionFor, type Session } from './app-helpers';
import { db, resetDb } from './helpers';

let admin: Session, petugas: Session, other: Session;

beforeAll(async () => {
  await resetDb();
  await seedBase();
  admin = (await sessionFor('ADMIN_INVENTARIS')).session; petugas = (await sessionFor('PETUGAS_INVENTARIS')).session; other = (await sessionFor('ADMIN_INVENTARIS')).session;
  await db.brand.create({ data: { name: 'Lenovo' } });
  await db.vendor.create({ data: { code: 'PT-MAJU', name: 'PT Maju' } });
  await db.person.create({ data: { name: 'Pak Hadi', nip: '1980' } });
  await db.location.create({ data: { code: 'R-101', name: 'Ruang 101', type: 'ROOM' } });
});
afterAll(() => db.$disconnect());

async function xlsx(headers: string[], rows: (string | number | Date | null)[][]) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Data');
  ws.addRow(headers);
  rows.forEach((r) => ws.addRow(r));
  return Buffer.from(await wb.xlsx.writeBuffer());
}
async function upload(path: string, session: Session, file: Buffer, filename = 'data.xlsx') {
  const app = await getApp();
  const boundary = '----imp';
  const body = Buffer.concat([Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: application/octet-stream\r\n\r\n`), file, Buffer.from(`\r\n--${boundary}--\r\n`)]);
  const res = await app.inject({ method: 'POST', url: `/api/v1${path}`, payload: body, headers: { cookie: session.cookie, 'x-csrf-token': session.csrf, 'content-type': `multipart/form-data; boundary=${boundary}` } });
  return { status: res.statusCode, body: res.json() };
}
const ITEM_H = ['Jenis', 'Nama Barang', 'Kode Kategori', 'Kode Satuan', 'Merek', 'Tipe/Model', 'Spesifikasi', 'Stok Minimum'];
const preview = (type: string, file: Buffer, s = admin) => upload(`/imports/${type}/preview`, s, file);
const commit = (type: string, body: object, s = admin) => call('POST', `/imports/${type}/commit`, { session: s, body });

describe('template', () => {
  it('setiap jenis menyediakan template XLSX dengan header, petunjuk, dan referensi dari master data', async () => {
    for (const t of ['items', 'assets', 'locations', 'opening-stock']) {
      const r = await call('GET', `/imports/template?type=${t}`, { session: admin });
      expect(r.status, t).toBe(200);
      expect(r.res.headers['content-disposition']).toContain(`template-impor-${t}.xlsx`);
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(r.res.rawPayload as unknown as ExcelJS.Buffer);
      expect(wb.worksheets.map((w) => w.name)).toEqual(['Data', 'Petunjuk', 'Referensi']);
      expect(wb.worksheets[0]!.rowCount).toBe(1); // hanya header, tanpa contoh yang bisa terimpor tidak sengaja
      expect(wb.worksheets[1]!.getCell(4, 1).value).toBe('Kolom');
    }
    const items = await call('GET', '/imports/template?type=items', { session: admin });
    const wb = new ExcelJS.Workbook(); await wb.xlsx.load(items.res.rawPayload as unknown as ExcelJS.Buffer);
    const refs: string[] = []; wb.worksheets[2]!.eachRow((r) => refs.push(String(r.getCell(1).value)));
    expect(refs).toEqual(expect.arrayContaining(['ELK', 'ATK', 'UNIT', 'Lenovo']));
    expect((await call('GET', '/imports/template?type=bogus', { session: admin })).status).toBe(400);
    expect((await call('GET', '/imports/template?type=items', { session: petugas })).status).toBe(403);
    expect((await call('GET', '/imports/template?type=items')).status).toBe(401);
  });

  it('daftar jenis impor mengikuti izin pengguna', async () => {
    expect((await call('GET', '/imports/types', { session: admin })).body.data.map((t: any) => t.key).sort()).toEqual(['assets', 'items', 'locations', 'opening-stock']);
    expect((await call('GET', '/imports/types', { session: petugas })).body.data).toEqual([]);
  });
});

describe('validasi file', () => {
  it('menolak file bukan XLSX, kolom wajib hilang, kosong, dan tanpa izin', async () => {
    expect((await upload('/imports/items/preview', admin, Buffer.from('a,b\n1,2'), 'data.csv')).status).toBe(400);
    expect((await upload('/imports/items/preview', admin, Buffer.from('MZ<script>'), 'x.xlsx')).body.message).toMatch(/Excel/);
    const noCol = await preview('items', await xlsx(['Nama Barang'], [['X']]));
    expect(noCol.status).toBe(400);
    expect(noCol.body.message).toMatch(/Kolom wajib tidak ditemukan.*Jenis/);
    expect((await preview('items', await xlsx(ITEM_H, []))).body.message).toMatch(/Tidak ada baris data/);
    expect((await preview('items', await xlsx(ITEM_H, [['Inventaris', 'X', 'ELK', 'UNIT', '', '', '', '']]), petugas)).status).toBe(403);
    expect((await preview('bogus', await xlsx(ITEM_H, []))).status).toBe(400);
  });
});

describe('import master barang', () => {
  it('skenario spesifikasi: 100 baris dengan 5 bermasalah, nomor baris dan alasan, tidak ada yang masuk sebelum konfirmasi', async () => {
    const rows: (string | null)[][] = [];
    for (let i = 1; i <= 95; i++) rows.push([i % 2 ? 'Inventaris' : 'Persediaan', `Barang Uji ${i}`, i % 2 ? 'ELK' : 'ATK', 'UNIT', i % 10 === 0 ? 'Lenovo' : '', `M${i}`, '', i % 2 ? '' : '5']);
    rows.splice(9, 0, ['Inventaris', '', 'ELK', 'UNIT', '', '', '', '']);                       // baris 11: nama kosong
    rows.splice(29, 0, ['Inventaris', 'Barang X', 'XXX', 'UNIT', '', '', '', '']);               // baris 31: kategori salah
    rows.splice(49, 0, ['Aset', 'Barang Y', 'ELK', 'UNIT', '', '', '', '']);                      // baris 51: jenis salah
    rows.splice(69, 0, ['Inventaris', 'Barang Uji 1', 'ELK', 'UNIT', '', 'M1', '', '']);          // baris 71: duplikat baris 2
    rows.splice(89, 0, ['Persediaan', 'Barang Z', 'ATK', 'UNIT', '', '', '', '-3']);              // baris 91: stok minimum negatif
    expect(rows).toHaveLength(100);
    const p = await preview('items', await xlsx(ITEM_H, rows));
    expect(p.status).toBe(200);
    expect(p.body.data).toMatchObject({ total: 100, valid: 95, errors: 5 });
    const bad = p.body.data.rows.filter((r: any) => r.status === 'error');
    expect(bad.map((r: any) => r.row).sort((a: number, b: number) => a - b)).toEqual([11, 31, 51, 71, 91]);
    expect(bad.find((r: any) => r.row === 11).errors[0]).toMatch(/Nama barang wajib/);
    expect(bad.find((r: any) => r.row === 31).errors[0]).toMatch(/kategori "XXX" tidak ditemukan/);
    expect(bad.find((r: any) => r.row === 51).errors[0]).toMatch(/Jenis "Aset" tidak dikenal/);
    expect(bad.find((r: any) => r.row === 71).errors[0]).toMatch(/Duplikat dengan baris 2/);
    expect(bad.find((r: any) => r.row === 91).errors[0]).toMatch(/Stok minimum/);
    expect(await db.item.count({ where: { name: { startsWith: 'Barang' } } })).toBe(0); // preview tidak menulis apa pun

    // laporan kesalahan XLSX berisi tepat 5 baris dengan alasan
    const rep = await call('GET', `/imports/batches/${p.body.data.batchId}/errors`, { session: admin });
    const wb = new ExcelJS.Workbook(); await wb.xlsx.load(rep.res.rawPayload as unknown as ExcelJS.Buffer);
    const ws = wb.worksheets[0]!;
    expect(ws.rowCount).toBe(6);
    expect(ws.getRow(1).getCell(1).value).toBe('Baris di file');
    expect(Number(ws.getRow(2).getCell(1).value)).toBe(11);
    expect(String(ws.getRow(3).getCell(2).value)).toMatch(/kategori/);
    // penjelajah baris di server
    const onlyErr = await call('GET', `/imports/batches/${p.body.data.batchId}/rows?status=error`, { session: admin });
    expect(onlyErr.body.meta.total).toBe(5);

    // commit tanpa konfirmasi lewati-baris-bermasalah ditolak
    const refused = await commit('items', { batchId: p.body.data.batchId });
    expect(refused.status).toBe(422);
    expect(refused.body.message).toMatch(/5 baris bermasalah/);
    expect(await db.item.count({ where: { name: { startsWith: 'Barang Uji' } } })).toBe(0);
    // pengguna lain tidak boleh meng-commit batch ini
    expect((await commit('items', { batchId: p.body.data.batchId, skipErrors: true }, other)).status).toBe(403);
    expect((await commit('items', { batchId: p.body.data.batchId, skipErrors: true }, petugas)).status).toBe(403);

    const done = await commit('items', { batchId: p.body.data.batchId, skipErrors: true });
    expect(done.status).toBe(200);
    expect(done.body.data).toMatchObject({ created: 95, skipped: 5 });
    expect(done.body.data.skippedRows.map((r: any) => r.row).sort((a: number, b: number) => a - b)).toEqual([11, 31, 51, 71, 91]);
    expect(await db.item.count({ where: { name: { startsWith: 'Barang Uji' } } })).toBe(95);
    const codes = (await db.item.findMany({ where: { name: { startsWith: 'Barang Uji' } } })).map((i) => i.code);
    expect(new Set(codes).size).toBe(95);
    expect(codes.every((c) => /^(BRG-ELK|PRS-ATK)-\d{6}$/.test(c))).toBe(true);
    expect((await db.item.findFirstOrThrow({ where: { name: 'Barang Uji 10' } })).brandId).not.toBeNull();
    expect(Number((await db.item.findFirstOrThrow({ where: { name: 'Barang Uji 2' } })).minStock)).toBe(5);
    // satu kali pakai
    expect((await commit('items', { batchId: p.body.data.batchId, skipErrors: true })).status).toBe(409);
    // audit
    const audit = await db.auditLog.findFirstOrThrow({ where: { action: 'IMPORT', entityId: p.body.data.batchId } });
    expect(audit.after).toMatchObject({ type: 'items', created: 95, skipped: 5 });
    expect(await db.auditLog.count({ where: { entityType: 'Item', action: 'CREATE' } })).toBeGreaterThanOrEqual(95);
    // impor ulang file yang sama: seluruhnya terdeteksi duplikat dengan database
    const again = await preview('items', await xlsx(ITEM_H, [['Inventaris', 'Barang Uji 1', 'ELK', 'UNIT', '', 'M1', '', '']]));
    expect(again.body.data.rows[0].errors[0]).toMatch(/sudah ada dengan kode BRG-ELK-/);
  });

  it('semua baris valid: dapat dikonfirmasi tanpa skipErrors; data berubah sejak preview terdeteksi saat commit', async () => {
    const p = await preview('items', await xlsx(ITEM_H, [['Inventaris', 'Proyektor Epson', 'ELK', 'UNIT', '', 'EB-X', '', ''], ['Persediaan', 'Spidol Hitam', 'ATK', 'BOX', '', '', '', '10']]));
    expect(p.body.data).toMatchObject({ total: 2, valid: 2, errors: 0 });
    // seseorang membuat barang yang sama setelah preview
    const cat = await db.category.findUniqueOrThrow({ where: { code: 'ELK' } });
    await db.item.create({ data: { code: 'BRG-ELK-999999', name: 'Proyektor Epson', model: 'EB-X', type: 'ASSET', categoryId: cat.id, unitOfMeasureId: (await db.unitOfMeasure.findUniqueOrThrow({ where: { code: 'UNIT' } })).id } });
    const stale = await commit('items', { batchId: p.body.data.batchId });
    expect(stale.status).toBe(409);
    expect(stale.body.message).toMatch(/Data berubah sejak preview: 1 baris/);
    expect(await db.item.count({ where: { name: 'Spidol Hitam' } })).toBe(0); // atomik: tidak ada yang masuk
    const partial = await commit('items', { batchId: p.body.data.batchId, skipErrors: true });
    expect(partial.body.data).toMatchObject({ created: 1, skipped: 1 });
    expect(partial.body.data.skippedRows[0].errors[0]).toMatch(/Duplikat/);
  });

  it('batch kedaluwarsa (24 jam) ditolak', async () => {
    const p = await preview('items', await xlsx(ITEM_H, [['Inventaris', 'Kamera Lama', 'ELK', 'UNIT', '', '', '', '']]));
    await db.importBatch.update({ where: { id: p.body.data.batchId }, data: { createdAt: new Date(Date.now() - 25 * 3600 * 1000) } });
    const r = await commit('items', { batchId: p.body.data.batchId });
    expect(r.status).toBe(422);
    expect(r.body.message).toMatch(/kedaluwarsa/);
    expect((await db.importBatch.findUniqueOrThrow({ where: { id: p.body.data.batchId } })).status).toBe('EXPIRED');
  });
});

describe('import lokasi', () => {
  const H = ['Kode Lokasi', 'Nama Lokasi', 'Tipe', 'Kode Lokasi Induk', 'Kode Unit'];
  it('hierarki dengan anak sebelum induk di file; siklus, induk tak dikenal, dan kode ganda ditolak', async () => {
    const p = await preview('locations', await xlsx(H, [
      ['R-A101', 'Ruang A101', 'Ruangan', 'LT-A1', 'UNIT-UTAMA'], ['LT-A1', 'Lantai 1', 'Lantai', 'GDG-A', ''], ['GDG-A', 'Gedung A', 'Gedung', '', ''],
      ['X1', 'Siklus 1', 'Ruangan', 'X2', ''], ['X2', 'Siklus 2', 'Ruangan', 'X1', ''],
      ['Y1', 'Induk hilang', 'Ruangan', 'TIDAK-ADA', ''], ['R-101', 'Sudah ada', 'Ruangan', '', ''], ['Z1', 'Tipe salah', 'Kamar', '', ''], ['GDG-A', 'Ganda', 'Gedung', '', ''],
    ]));
    expect(p.body.data).toMatchObject({ total: 9 });
    const errRows = p.body.data.rows.filter((r: any) => r.status === 'error').map((r: any) => r.row).sort((a: number, b: number) => a - b);
    // baris 3 (LT-A1) dan 2 (R-A101) bergantung pada GDG-A yang kodenya ganda -> hanya baris ganda yang ditolak; GDG-A ganda ditandai keduanya
    expect(errRows).toEqual(expect.arrayContaining([5, 6, 7, 8, 9, 10]));
    const done = await commit('locations', { batchId: p.body.data.batchId, skipErrors: true });
    expect(done.status).toBe(200);
  });

  it('hierarki valid dibuat dengan induk yang benar walau urutan baris terbalik', async () => {
    const p = await preview('locations', await xlsx(H, [['R-B101', 'Ruang B101', 'Ruangan', 'LT-B1', 'UNIT-UTAMA'], ['LT-B1', 'Lantai B1', 'Lantai', 'GDG-B', ''], ['GDG-B', 'Gedung B', 'Gedung', '', '']]));
    expect(p.body.data).toMatchObject({ valid: 3, errors: 0 });
    expect((await commit('locations', { batchId: p.body.data.batchId })).status).toBe(200);
    const r = await db.location.findUniqueOrThrow({ where: { code: 'R-B101' }, include: { parent: { include: { parent: true } }, unit: true } });
    expect([r.parent?.code, r.parent?.parent?.code, r.unit?.code]).toEqual(['LT-B1', 'GDG-B', 'UNIT-UTAMA']);
  });
});

describe('import aset', () => {
  const H = ['Kode Barang', 'Nomor Seri', 'Tahun Perolehan', 'Tanggal Perolehan', 'Harga Perolehan', 'Kondisi', 'Kode Unit', 'Kode Lokasi', 'NIP Penanggung Jawab', 'Kode Sumber Perolehan', 'Kode Vendor', 'Catatan'];
  it('membuat unit aset dengan kode otomatis, histori awal, referensi terselesaikan; serial ganda dan referensi salah ditolak', async () => {
    const item = (await call('POST', '/items', { session: admin, body: { name: 'Laptop Impor', type: 'ASSET', categoryId: (await db.category.findUniqueOrThrow({ where: { code: 'ELK' } })).id, unitOfMeasureId: (await db.unitOfMeasure.findUniqueOrThrow({ where: { code: 'UNIT' } })).id } })).body.data;
    await db.asset.create({ data: { code: 'INV-OLD-1', itemId: item.id, serialNumber: 'SN-EXIST', acquisitionYear: 2025, unitId: (await db.organizationalUnit.findFirstOrThrow()).id, locationId: (await db.location.findFirstOrThrow()).id } });
    const p = await preview('assets', await xlsx(H, [
      [item.code, 'SN-1', 2026, '15/03/2026', 12500000, 'Baik', 'UNIT-UTAMA', 'R-101', '1980', 'ANGGARAN', 'PT-MAJU', 'Dari import'],
      [item.code, 'SN-2', 2026, '2026-03-16', 9000000, 'Rusak ringan', 'UNIT-UTAMA', 'R-101', '', '', '', ''],
      [item.code, '', 2026, '', '', '', 'UNIT-UTAMA', 'R-101', '', '', '', ''],
      [item.code, 'SN-1', 2026, '', 0, '', 'UNIT-UTAMA', 'R-101', '', '', '', ''],
      [item.code, 'SN-EXIST', 2026, '', 0, '', 'UNIT-UTAMA', 'R-101', '', '', '', ''],
      [item.code, 'SN-9', 2026, '', 0, '', 'UNIT-UTAMA', 'LOKASI-X', '', '', '', ''],
      ['BRG-TIDAK-ADA', 'SN-10', 2026, '', 0, '', 'UNIT-UTAMA', 'R-101', '', '', '', ''],
      [item.code, 'SN-11', 1800, '31/02/2026', 'abc', 'Hancur', 'UNIT-UTAMA', 'R-101', '9999', 'XXX', 'YYY', ''],
    ]));
    expect(p.body.data).toMatchObject({ total: 8, valid: 3, errors: 5, withWarnings: 1 });
    const byRow = (n: number) => p.body.data.rows.find((r: any) => r.row === n);
    expect(byRow(5).errors[0]).toMatch(/sama dengan baris 2/);
    expect(byRow(6).errors[0]).toMatch(/sudah terdaftar untuk barang ini/);
    expect(byRow(7).errors[0]).toMatch(/lokasi "LOKASI-X"/);
    expect(byRow(8).errors[0]).toMatch(/BRG-TIDAK-ADA/);
    expect(byRow(9).errors.length).toBeGreaterThanOrEqual(6);
    expect(byRow(4).warnings).toContain('Tanpa nomor seri');
    const done = await commit('assets', { batchId: p.body.data.batchId, skipErrors: true });
    expect(done.body.data).toMatchObject({ created: 3, skipped: 5 });
    const a = await db.asset.findFirstOrThrow({ where: { serialNumber: 'SN-1' }, include: { vendor: true, fundingSource: true, person: true } });
    expect(a.code).toMatch(/^INV-ELK-2026-\d{6}$/);
    expect([a.vendor?.code, a.fundingSource?.code, a.person?.nip, a.acquisitionCost.toString(), a.acquisitionDate?.toISOString().slice(0, 10), a.notes]).toEqual(['PT-MAJU', 'ANGGARAN', '1980', '12500000', '2026-03-15', 'Dari import']);
    expect((await db.asset.findFirstOrThrow({ where: { serialNumber: 'SN-2' } })).condition).toBe('MINOR_DAMAGE');
    expect(await db.assetLocationHistory.count({ where: { assetId: a.id, sourceType: 'REGISTRATION' } })).toBe(1);
    expect(await db.asset.count({ where: { code: { startsWith: 'INV-ELK-2026' } } })).toBe(3);
  });
});

describe('import saldo awal persediaan', () => {
  const H = ['Kode Barang', 'Kode Gudang', 'Jumlah', 'Harga Satuan', 'Tanggal Saldo', 'Catatan'];
  it('dicatat sebagai transaksi pembukaan (OPENING) di ledger dan terlihat di kartu stok', async () => {
    const mk = async (name: string) => (await call('POST', '/items', { session: admin, body: { name, type: 'SUPPLY', categoryId: (await db.category.findUniqueOrThrow({ where: { code: 'ATK' } })).id, unitOfMeasureId: (await db.unitOfMeasure.findUniqueOrThrow({ where: { code: 'RIM' } })).id } })).body.data;
    const [k, t, b] = [await mk('Kertas Saldo'), await mk('Tinta Saldo'), await mk('Map Saldo')];
    const asset = (await db.item.findFirstOrThrow({ where: { type: 'ASSET' } }));
    await call('POST', '/stocks/in', { session: admin, body: { warehouseId: (await db.warehouse.findFirstOrThrow()).id, date: '2026-01-01', lines: [{ itemId: b.id, quantity: 5 }] } });
    const p = await preview('opening-stock', await xlsx(H, [
      [k.code, 'GDG-UTAMA', 100, 50000, '2026-01-01', 'Saldo awal tahun'], [t.code, 'GDG-UTAMA', 25.5, '', '01/01/2026', ''],
      [k.code, 'GDG-UTAMA', 10, '', '2026-01-01', ''], [b.code, 'GDG-UTAMA', 7, '', '2026-01-01', ''], [t.code, 'GDG-X', 1, '', '2026-01-01', ''],
      [k.code, 'GDG-UTAMA', -4, '', '2026-01-01', ''], [asset.code, 'GDG-UTAMA', 4, '', '2026-01-01', ''], [t.code, 'GDG-UTAMA', 4, '', 'kemarin', ''],
    ]));
    expect(p.body.data).toMatchObject({ total: 8, valid: 2, errors: 6 });
    const byRow = (n: number) => p.body.data.rows.find((r: any) => r.row === n).errors.join(' ');
    expect(byRow(4)).toMatch(/baris 2/);
    expect(byRow(5)).toMatch(/sudah memiliki transaksi stok/);
    expect(byRow(6)).toMatch(/gudang "GDG-X"/);
    expect(byRow(7)).toMatch(/lebih dari 0/);
    expect(byRow(8)).toMatch(/bukan barang Persediaan/);
    expect(byRow(9)).toMatch(/Tanggal saldo/);
    expect((await commit('opening-stock', { batchId: p.body.data.batchId })).status).toBe(422);
    const done = await commit('opening-stock', { batchId: p.body.data.batchId, skipErrors: true });
    expect(done.body.data).toMatchObject({ created: 2, skipped: 6 });
    const bal = await db.stockBalance.findFirstOrThrow({ where: { itemId: k.id } });
    expect(bal.quantity.toString()).toBe('100');
    expect((await db.stockBalance.findFirstOrThrow({ where: { itemId: t.id } })).quantity.toString()).toBe('25.5');
    const tx = await db.stockTransaction.findFirstOrThrow({ where: { type: 'OPENING', sourceType: 'IMPORT' }, include: { details: true } });
    expect(tx.number).toMatch(/^SAW-\d{4}-\d{4}$/);
    expect(tx.details).toHaveLength(2);
    expect(tx.details.every((d) => d.quantityOut.toString() === '0' && d.balanceAfter.gt(0))).toBe(true);
    const card = await call('GET', `/stocks/${k.id}/card?warehouseId=${bal.warehouseId}`, { session: admin });
    expect(card.body.data.map((r: any) => [r.type, r.in, r.balance])).toEqual([['OPENING', '100', '100']]);
    const noMore = await preview('opening-stock', await xlsx(H, [[k.code, 'GDG-UTAMA', 5, '', '2026-02-01', '']]));
    expect(noMore.body.data.rows[0].errors[0]).toMatch(/sudah memiliki transaksi stok/);
  });
});
