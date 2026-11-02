import ExcelJS from 'exceljs';
import { fileTypeFromBuffer } from 'file-type';
import { badRequest } from '../../lib/errors';
import { COLUMNS, MAX_IMPORT_ROWS, type ImportKey, type RawRow } from './types';

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

function cellText(v: ExcelJS.CellValue): string {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'object') {
    const o = v as unknown as Record<string, unknown>;
    if ('richText' in o) return (o.richText as { text: string }[]).map((t) => t.text).join('').trim();
    if ('result' in o) return cellText(o.result as ExcelJS.CellValue);
    if ('text' in o) return String(o.text).trim();
    return '';
  }
  return String(v).trim();
}

/** Baca sheet pertama. Baris = nomor baris Excel (header di baris 1), sehingga pesan galat cocok dengan file pengguna. */
export async function parseWorkbook(buffer: Buffer, key: ImportKey): Promise<{ rows: { row: number; raw: RawRow }[]; ignoredColumns: string[] }> {
  const type = await fileTypeFromBuffer(buffer);
  if (type?.mime !== 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet') {
    throw badRequest('File harus berformat Excel (.xlsx). Gunakan template dari tombol Unduh template.');
  }
  const wb = new ExcelJS.Workbook();
  try { await wb.xlsx.load(buffer as unknown as ExcelJS.Buffer); } catch { throw badRequest('File Excel tidak dapat dibaca. Pastikan tidak rusak atau terkunci kata sandi.'); }
  const ws = wb.worksheets[0];
  if (!ws) throw badRequest('File tidak memiliki lembar data.');

  const defs = COLUMNS[key];
  const headerRow = ws.getRow(1);
  const colIndex = new Map<string, number>();
  const ignored: string[] = [];
  headerRow.eachCell((cell, col) => {
    const h = norm(cellText(cell.value));
    if (!h) return;
    const def = defs.find((d) => norm(d.header) === h);
    if (def && !colIndex.has(def.key)) colIndex.set(def.key, col); else ignored.push(cellText(cell.value));
  });
  const missing = defs.filter((d) => d.required && !colIndex.has(d.key)).map((d) => d.header);
  if (missing.length) throw badRequest(`Kolom wajib tidak ditemukan di baris 1: ${missing.join(', ')}. Gunakan template terbaru.`);

  const rows: { row: number; raw: RawRow }[] = [];
  for (let r = 2; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const raw: RawRow = {};
    let any = false;
    for (const d of defs) {
      const idx = colIndex.get(d.key);
      raw[d.key] = idx ? cellText(row.getCell(idx).value) : '';
      if (raw[d.key]) any = true;
    }
    if (!any) continue; // baris kosong dilewati
    rows.push({ row: r, raw });
    if (rows.length > MAX_IMPORT_ROWS) throw badRequest(`Maksimal ${MAX_IMPORT_ROWS} baris per file. Pecah file menjadi beberapa bagian.`);
  }
  if (!rows.length) throw badRequest('Tidak ada baris data. Isi data mulai dari baris 2.');
  return { rows, ignoredColumns: ignored };
}

export const parseDate = (s: string): Date | null => {
  if (!s) return null;
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) { const d = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/); if (d) m = [d[0], d[3]!, d[2]!.padStart(2, '0'), d[1]!.padStart(2, '0')] as unknown as RegExpMatchArray; }
  if (!m) return null;
  const dt = new Date(`${m[1]}-${m[2]}-${m[3]}T00:00:00Z`);
  return Number.isNaN(dt.getTime()) || dt.toISOString().slice(0, 10) !== `${m[1]}-${m[2]}-${m[3]}` ? null : dt;
};

export const parseNumber = (s: string): number | null => {
  if (s === '') return null;
  const n = Number(s.replace(/\s/g, ''));
  return Number.isFinite(n) ? n : NaN;
};
