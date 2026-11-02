import ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';
import type { Col, ReportResult } from './definitions';

export interface ExportMeta { title: string; filterText: string; generatedBy: string; generatedAt: Date }

const fmt = {
  money: new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }),
  number: new Intl.NumberFormat('id-ID', { maximumFractionDigits: 3 }),
};
const dateId = (iso: string) => new Date(iso).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' });

export function displayValue(col: Col, v: unknown): string {
  if (v === null || v === undefined || v === '') return '-';
  if (col.type === 'money') return fmt.money.format(Number(v));
  if (col.type === 'number') return fmt.number.format(Number(v));
  if (col.type === 'date') return dateId(String(v));
  return String(v);
}

export async function buildXlsx(cols: Col[], result: ReportResult, meta: ExportMeta): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'SIMA';
  wb.created = meta.generatedAt;
  const ws = wb.addWorksheet(meta.title.slice(0, 31), { views: [{ state: 'frozen', ySplit: 4 }] });
  ws.mergeCells(1, 1, 1, Math.max(cols.length, 2));
  ws.getCell(1, 1).value = meta.title;
  ws.getCell(1, 1).font = { bold: true, size: 14, color: { argb: 'FF172554' } };
  ws.getCell(2, 1).value = meta.filterText;
  ws.getCell(3, 1).value = `Dibuat ${meta.generatedAt.toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' })} oleh ${meta.generatedBy}`;
  ws.getCell(2, 1).font = ws.getCell(3, 1).font = { size: 9, color: { argb: 'FF475569' } };

  const header = ws.getRow(4);
  cols.forEach((c, i) => {
    const cell = header.getCell(i + 1);
    cell.value = c.header;
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF172554' } };
    cell.alignment = { vertical: 'middle', wrapText: true, horizontal: c.type === 'number' || c.type === 'money' ? 'right' : 'left' };
    ws.getColumn(i + 1).width = c.width ?? 14;
  });
  header.height = 22;

  result.rows.forEach((r, ri) => {
    const row = ws.getRow(5 + ri);
    cols.forEach((c, i) => {
      const v = r[c.key];
      const cell = row.getCell(i + 1);
      if (v === null || v === undefined || v === '') return;
      if (c.type === 'number' || c.type === 'money') { cell.value = Number(v); cell.numFmt = c.type === 'money' ? '"Rp" #,##0' : '#,##0.###'; }
      else if (c.type === 'date') { cell.value = new Date(String(v)); cell.numFmt = 'dd mmm yyyy'; }
      else cell.value = String(v);
    });
  });
  ws.autoFilter = { from: { row: 4, column: 1 }, to: { row: 4 + Math.max(result.rows.length, 1), column: cols.length } };

  let r = 6 + result.rows.length;
  for (const s of result.summary ?? []) {
    ws.getCell(r, 1).value = s.label; ws.getCell(r, 1).font = { bold: true };
    const cell = ws.getCell(r, 2);
    cell.value = s.type === 'money' || s.type === 'number' ? Number(s.value) : String(s.value);
    if (s.type === 'money') cell.numFmt = '"Rp" #,##0';
    cell.font = { bold: true };
    r++;
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}

// Helvetica bawaan PDF hanya WinAnsi: karakter di luar rentang diganti agar teks tidak rusak.
const safe = (s: string) => s.replace(/[^\x20-\x7E -ÿ]/g, '?');

export function buildPdf(cols: Col[], result: ReportResult, meta: ExportMeta): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 30, bufferPages: true, info: { Title: meta.title, Author: 'SIMA' } });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const left = doc.page.margins.left;
    const usable = doc.page.width - left - doc.page.margins.right;
    const totalW = cols.reduce((s, c) => s + (c.width ?? 14), 0);
    const widths = cols.map((c) => ((c.width ?? 14) / totalW) * usable);
    const ROW_H = 16, HEAD_H = 20;

    const drawHead = (y: number) => {
      doc.rect(left, y, usable, HEAD_H).fill('#172554');
      let x = left;
      cols.forEach((c, i) => {
        doc.fillColor('#FFFFFF').font('Helvetica-Bold').fontSize(8).text(safe(c.header), x + 3, y + 6, { width: widths[i]! - 6, height: 10, ellipsis: true, align: c.type === 'number' || c.type === 'money' ? 'right' : 'left', lineBreak: false });
        x += widths[i]!;
      });
      return y + HEAD_H;
    };

    doc.fillColor('#172554').font('Helvetica-Bold').fontSize(14).text(safe(meta.title), left, 30);
    doc.fillColor('#475569').font('Helvetica').fontSize(8).text(safe(meta.filterText), left, 50);
    doc.text(safe(`Dibuat ${meta.generatedAt.toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' })} oleh ${meta.generatedBy}`), left, 61);
    let y = drawHead(78);

    result.rows.forEach((row, ri) => {
      if (y + ROW_H > doc.page.height - doc.page.margins.bottom - 14) { doc.addPage(); y = drawHead(30); }
      if (ri % 2 === 1) doc.rect(left, y, usable, ROW_H).fill('#F8FAFC');
      let x = left;
      cols.forEach((c, i) => {
        doc.fillColor('#1E293B').font('Helvetica').fontSize(8).text(safe(displayValue(c, row[c.key])), x + 3, y + 4, { width: widths[i]! - 6, height: 10, ellipsis: true, lineBreak: false, align: c.type === 'number' || c.type === 'money' ? 'right' : 'left' });
        x += widths[i]!;
      });
      y += ROW_H;
    });
    if (!result.rows.length) doc.fillColor('#475569').text('Tidak ada data pada filter ini.', left, y + 6);

    y += 10;
    for (const s of result.summary ?? []) {
      if (y + 14 > doc.page.height - doc.page.margins.bottom - 14) { doc.addPage(); y = 30; }
      doc.fillColor('#1E293B').font('Helvetica-Bold').fontSize(9).text(safe(`${s.label}: ${displayValue({ key: '', header: '', type: s.type }, s.value)}`), left, y);
      y += 14;
    }

    const range = doc.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i++) {
      doc.switchToPage(i);
      doc.fillColor('#64748B').font('Helvetica').fontSize(8).text(`Halaman ${i + 1} dari ${range.count}`, left, doc.page.height - 24, { width: usable, align: 'right', lineBreak: false });
    }
    doc.end();
  });
}
