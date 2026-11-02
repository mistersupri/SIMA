import ExcelJS from 'exceljs';
import { prisma } from '../../lib/prisma';
import { COLUMNS, IMPORT_LABEL, type ImportKey } from './types';

const NAVY = 'FF172554';

async function references(key: ImportKey): Promise<{ title: string; rows: string[][] }[]> {
  const act = { where: { isActive: true } } as const;
  if (key === 'items') {
    const [c, u, b] = await Promise.all([prisma.category.findMany({ ...act, orderBy: { code: 'asc' } }), prisma.unitOfMeasure.findMany({ ...act, orderBy: { code: 'asc' } }), prisma.brand.findMany({ ...act, orderBy: { name: 'asc' } })]);
    return [{ title: 'Kategori (Kode Kategori)', rows: c.map((x) => [x.code, x.name]) }, { title: 'Satuan (Kode Satuan)', rows: u.map((x) => [x.code, x.name]) }, { title: 'Merek', rows: b.map((x) => [x.name, '']) }];
  }
  if (key === 'assets') {
    const [u, l, f, v] = await Promise.all([prisma.organizationalUnit.findMany({ ...act, orderBy: { code: 'asc' } }), prisma.location.findMany({ ...act, orderBy: { code: 'asc' } }), prisma.fundingSource.findMany({ ...act, orderBy: { code: 'asc' } }), prisma.vendor.findMany({ ...act, orderBy: { code: 'asc' } })]);
    return [{ title: 'Unit kerja (Kode Unit)', rows: u.map((x) => [x.code, x.name]) }, { title: 'Lokasi (Kode Lokasi)', rows: l.map((x) => [x.code, x.name]) }, { title: 'Sumber perolehan', rows: f.map((x) => [x.code, x.name]) }, { title: 'Vendor', rows: v.map((x) => [x.code, x.name]) }];
  }
  if (key === 'locations') return [{ title: 'Unit kerja (Kode Unit)', rows: (await prisma.organizationalUnit.findMany({ ...act, orderBy: { code: 'asc' } })).map((x) => [x.code, x.name]) }];
  return [{ title: 'Gudang (Kode Gudang)', rows: (await prisma.warehouse.findMany({ ...act, orderBy: { code: 'asc' } })).map((x) => [x.code, x.name]) }];
}

/** Template: lembar Data hanya berisi header (tidak ada baris contoh yang bisa terimpor tanpa sengaja). */
export async function buildTemplate(key: ImportKey): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'SIMA';
  const defs = COLUMNS[key];

  const data = wb.addWorksheet('Data', { views: [{ state: 'frozen', ySplit: 1 }] });
  defs.forEach((d, i) => {
    const cell = data.getRow(1).getCell(i + 1);
    cell.value = d.header;
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: d.required ? NAVY : 'FF475569' } };
    cell.alignment = { vertical: 'middle', wrapText: true };
    data.getColumn(i + 1).width = Math.max(d.header.length + 4, 18);
    if (d.key === 'kodeBarang' || d.key === 'nomorSeri' || d.key === 'penanggungJawab' || d.key === 'kode') data.getColumn(i + 1).numFmt = '@'; // teks, agar angka depan 0/NIP tidak berubah
  });
  data.getRow(1).height = 24;

  const help = wb.addWorksheet('Petunjuk');
  help.mergeCells('A1:D1');
  help.getCell('A1').value = `Template impor: ${IMPORT_LABEL[key]}`;
  help.getCell('A1').font = { bold: true, size: 14, color: { argb: NAVY } };
  help.getCell('A2').value = 'Isi data pada lembar "Data" mulai baris 2. Jangan mengubah nama kolom di baris 1. Kolom bertanda Wajib = Ya harus terisi. Baris yang bermasalah tidak akan diimpor.';
  help.mergeCells('A2:D2');
  help.getRow(2).alignment = { wrapText: true }; help.getRow(2).height = 32;
  ['Kolom', 'Wajib', 'Keterangan', 'Contoh'].forEach((h, i) => { const c = help.getRow(4).getCell(i + 1); c.value = h; c.font = { bold: true, color: { argb: 'FFFFFFFF' } }; c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: NAVY } }; });
  defs.forEach((d, i) => { const r = help.getRow(5 + i); r.getCell(1).value = d.header; r.getCell(2).value = d.required ? 'Ya' : 'Tidak'; r.getCell(3).value = d.note; r.getCell(4).value = d.example; });
  [26, 8, 60, 30].forEach((w, i) => (help.getColumn(i + 1).width = w));

  const ref = wb.addWorksheet('Referensi');
  let row = 1;
  for (const block of await references(key)) {
    ref.getCell(row, 1).value = block.title; ref.getCell(row, 1).font = { bold: true, color: { argb: NAVY } }; row++;
    for (const r of block.rows) { ref.getCell(row, 1).value = r[0]; ref.getCell(row, 2).value = r[1]; row++; }
    if (!block.rows.length) { ref.getCell(row, 1).value = '(belum ada data di Master Data)'; row++; }
    row++;
  }
  ref.getColumn(1).width = 30; ref.getColumn(2).width = 40;
  return Buffer.from(await wb.xlsx.writeBuffer());
}

export async function buildErrorReport(key: ImportKey, rows: { row: number; raw: Record<string, string>; errors: string[] }[]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Kesalahan', { views: [{ state: 'frozen', ySplit: 1 }] });
  const defs = COLUMNS[key];
  const headers = ['Baris di file', 'Kesalahan', ...defs.map((d) => d.header)];
  headers.forEach((h, i) => { const c = ws.getRow(1).getCell(i + 1); c.value = h; c.font = { bold: true, color: { argb: 'FFFFFFFF' } }; c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: i < 2 ? 'FFB91C1C' : NAVY } }; });
  rows.forEach((r, i) => {
    const row = ws.getRow(2 + i);
    row.getCell(1).value = r.row;
    row.getCell(2).value = r.errors.join('; ');
    row.getCell(2).alignment = { wrapText: true, vertical: 'top' };
    defs.forEach((d, j) => (row.getCell(3 + j).value = r.raw[d.key] ?? ''));
  });
  ws.getColumn(1).width = 12; ws.getColumn(2).width = 70;
  defs.forEach((d, j) => (ws.getColumn(3 + j).width = Math.max(d.header.length + 2, 16)));
  return Buffer.from(await wb.xlsx.writeBuffer());
}
