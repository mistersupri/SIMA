import { Prisma, type PrismaClient } from '@prisma/client';
import type { FastifyRequest } from 'fastify';
import { writeAudit } from '../../lib/audit';
import { nextSequence, pad } from '../../lib/sequence';
import { createAssetUnits } from '../assets/service';
import { postStockTransaction } from '../stocks/service';
import { parseDate, parseNumber } from './parse';
import type { ImportKey, RawRow, RowResult } from './types';

type Db = PrismaClient | Prisma.TransactionClient;
const lc = (s: string) => s.trim().toLowerCase();
const up = (s: string) => s.trim().toUpperCase();
const CONDITION: Record<string, 'GOOD' | 'MINOR_DAMAGE' | 'MAJOR_DAMAGE'> = { baik: 'GOOD', 'rusak ringan': 'MINOR_DAMAGE', 'rusak berat': 'MAJOR_DAMAGE' };
const LOCATION_TYPE: Record<string, 'BUILDING' | 'FLOOR' | 'ROOM' | 'WAREHOUSE_AREA' | 'OTHER'> = { gedung: 'BUILDING', lantai: 'FLOOR', ruangan: 'ROOM', 'area gudang': 'WAREHOUSE_AREA', lainnya: 'OTHER' };

export interface Prepared { row: number; raw: RawRow; data: any }
export interface Validated { results: RowResult[]; prepared: Prepared[] }

const bucket = (rows: { row: number; raw: RawRow }[]): RowResult[] => rows.map((r) => ({ row: r.row, raw: r.raw, errors: [], warnings: [] }));
const err = (r: RowResult, m: string) => void r.errors.push(m);

/** Validasi per baris terhadap kondisi database SAAT INI. Dipakai ulang saat commit agar data yang berubah sejak preview tertangkap. */
export async function validateRows(db: Db, key: ImportKey, rows: { row: number; raw: RawRow }[]): Promise<Validated> {
  const results = bucket(rows);
  const prepared: Prepared[] = [];
  const keep = (res: RowResult, data: unknown) => { if (!res.errors.length) prepared.push({ row: res.row, raw: res.raw, data }); };

  if (key === 'locations') {
    const [existing, units] = await Promise.all([db.location.findMany({ select: { code: true } }), db.organizationalUnit.findMany({ where: { isActive: true }, select: { id: true, code: true } })]);
    const exist = new Set(existing.map((l) => l.code));
    const existingActive = new Map((await db.location.findMany({ where: { isActive: true }, select: { id: true, code: true } })).map((l) => [l.code, l.id]));
    const unitBy = new Map(units.map((u) => [u.code, u.id]));
    const fileCodes = new Map<string, number>();
    results.forEach((r) => { const c = up(r.raw.kode ?? ''); if (c) fileCodes.set(c, (fileCodes.get(c) ?? 0) + 1); });
    for (const r of results) {
      const code = up(r.raw.kode ?? '').replace(/\s+/g, '-');
      if (!code) err(r, 'Kode lokasi wajib diisi'); else if (code.length > 30) err(r, 'Kode lokasi maksimal 30 karakter');
      else if (exist.has(code)) err(r, `Kode ${code} sudah ada di database`); else if ((fileCodes.get(up(r.raw.kode ?? '')) ?? 0) > 1) err(r, `Kode ${code} muncul lebih dari sekali di file`);
      if (!r.raw.nama) err(r, 'Nama lokasi wajib diisi'); else if (r.raw.nama.length > 150) err(r, 'Nama lokasi maksimal 150 karakter');
      const type = LOCATION_TYPE[lc(r.raw.tipe ?? '')];
      if (!type) err(r, `Tipe "${r.raw.tipe}" tidak dikenal. Gunakan Gedung, Lantai, Ruangan, Area gudang, atau Lainnya`);
      const unitId = r.raw.unit ? unitBy.get(up(r.raw.unit)) : null;
      if (r.raw.unit && !unitId) err(r, `Kode unit ${r.raw.unit} tidak ditemukan atau nonaktif`);
      const parentCode = up(r.raw.induk ?? '');
      if (parentCode && !existingActive.has(parentCode) && !fileCodes.has(parentCode)) err(r, `Lokasi induk ${parentCode} tidak ditemukan di database maupun file`);
      if (parentCode && parentCode === code) err(r, 'Lokasi tidak boleh menjadi induk dirinya sendiri');
      keep(r, { code, name: r.raw.nama, type, unitId: unitId ?? null, parentCode: parentCode || null });
    }
    // Siklus antar-baris dalam file (A induk B, B induk A).
    const parentOf = new Map(prepared.map((p) => [p.data.code as string, p.data.parentCode as string | null]));
    for (const p of [...prepared]) {
      const seen = new Set<string>(); let c: string | null = p.data.code;
      while (c && parentOf.has(c)) { if (seen.has(c)) { err(results.find((x) => x.row === p.row)!, 'Hierarki induk membentuk siklus'); prepared.splice(prepared.indexOf(p), 1); break; } seen.add(c); c = parentOf.get(c) ?? null; }
    }
    // Induk yang barisnya sendiri bermasalah membuat anaknya ikut tidak valid.
    const okCodes = new Set(prepared.map((p) => p.data.code as string));
    for (let changed = true; changed;) {
      changed = false;
      for (const p of [...prepared]) {
        const pc = p.data.parentCode as string | null;
        if (pc && !existingActive.has(pc) && !okCodes.has(pc)) { err(results.find((x) => x.row === p.row)!, `Lokasi induk ${pc} pada file memiliki kesalahan sehingga baris ini tidak dapat diimpor`); prepared.splice(prepared.indexOf(p), 1); okCodes.delete(p.data.code); changed = true; }
      }
    }
    return { results, prepared };
  }

  if (key === 'items') {
    const [cats, uoms, brands, existing] = await Promise.all([
      db.category.findMany({ where: { isActive: true } }), db.unitOfMeasure.findMany({ where: { isActive: true } }), db.brand.findMany({ where: { isActive: true } }),
      db.item.findMany({ select: { code: true, name: true, model: true, type: true, categoryId: true } }),
    ]);
    const catBy = new Map(cats.map((c) => [c.code, c])), uomBy = new Map(uoms.map((u) => [u.code, u])), brandBy = new Map(brands.map((b) => [lc(b.name), b]));
    const sig = (t: string, name: string, model: string | null, cat: string) => `${t}|${lc(name)}|${lc(model ?? '')}|${cat}`;
    const known = new Map(existing.map((i) => [sig(i.type, i.name, i.model, i.categoryId), i.code]));
    const inFile = new Map<string, number>();
    for (const r of results) {
      const type: 'ASSET' | 'SUPPLY' | undefined = ({ inventaris: 'ASSET', persediaan: 'SUPPLY' } as Record<string, 'ASSET' | 'SUPPLY'>)[lc(r.raw.jenis ?? '')];
      if (!type) err(r, `Jenis "${r.raw.jenis}" tidak dikenal. Gunakan Inventaris atau Persediaan`);
      if (!r.raw.nama) err(r, 'Nama barang wajib diisi'); else if (r.raw.nama.length > 200) err(r, 'Nama barang maksimal 200 karakter');
      const cat = catBy.get(up(r.raw.kategori ?? '')); if (!cat) err(r, `Kode kategori "${r.raw.kategori}" tidak ditemukan atau nonaktif`);
      const uom = uomBy.get(up(r.raw.satuan ?? '')); if (!uom) err(r, `Kode satuan "${r.raw.satuan}" tidak ditemukan atau nonaktif`);
      const brand = r.raw.merek ? brandBy.get(lc(r.raw.merek)) : null; if (r.raw.merek && !brand) err(r, `Merek "${r.raw.merek}" belum ada di Master Data`);
      const min = parseNumber(r.raw.stokMinimum ?? ''); if (Number.isNaN(min) || (min !== null && min < 0)) err(r, 'Stok minimum harus angka >= 0');
      if (type === 'ASSET' && min) r.warnings.push('Stok minimum diabaikan untuk barang Inventaris');
      if (type && cat && r.raw.nama) {
        const s = sig(type, r.raw.nama, r.raw.model || null, cat.id);
        if (known.has(s)) err(r, `Duplikat: barang yang sama sudah ada dengan kode ${known.get(s)}`);
        else if (inFile.has(s)) err(r, `Duplikat dengan baris ${inFile.get(s)} di file ini`);
        else inFile.set(s, r.row);
      }
      keep(r, { type, name: r.raw.nama, categoryId: cat?.id, prefix: cat?.codePrefix, unitOfMeasureId: uom?.id, brandId: brand?.id ?? null, model: r.raw.model || null, specification: r.raw.spesifikasi || null, minStock: type === 'SUPPLY' ? (min ?? 0) : 0 });
    }
    return { results, prepared };
  }

  if (key === 'assets') {
    const [items, units, locs, persons, funds, vendors, serials] = await Promise.all([
      db.item.findMany({ where: { type: 'ASSET', isActive: true }, include: { category: true } }), db.organizationalUnit.findMany({ where: { isActive: true } }), db.location.findMany({ where: { isActive: true } }),
      db.person.findMany({ where: { isActive: true, nip: { not: null } } }), db.fundingSource.findMany({ where: { isActive: true } }), db.vendor.findMany({ where: { isActive: true } }),
      db.asset.findMany({ where: { serialNumber: { not: null } }, select: { itemId: true, serialNumber: true } }),
    ]);
    const itemBy = new Map(items.map((i) => [i.code, i])), unitBy = new Map(units.map((u) => [u.code, u])), locBy = new Map(locs.map((l) => [l.code, l])), personBy = new Map(persons.map((p) => [p.nip!, p]));
    const fundBy = new Map(funds.map((f) => [f.code, f])), vendorBy = new Map(vendors.map((v) => [v.code, v]));
    const taken = new Set(serials.map((s) => `${s.itemId}|${lc(s.serialNumber!)}`));
    const inFile = new Map<string, number>();
    const thisYear = new Date().getUTCFullYear();
    for (const r of results) {
      const item = itemBy.get(up(r.raw.kodeBarang ?? '')); if (!item) err(r, `Kode barang "${r.raw.kodeBarang}" tidak ditemukan, nonaktif, atau bukan barang Inventaris`);
      const year = Number(r.raw.tahun); if (!Number.isInteger(year) || year < 1950 || year > thisYear + 1) err(r, 'Tahun perolehan harus empat digit yang wajar');
      const date = r.raw.tanggal ? parseDate(r.raw.tanggal) : null; if (r.raw.tanggal && !date) err(r, 'Tanggal perolehan tidak valid (gunakan YYYY-MM-DD atau DD/MM/YYYY)');
      const cost = parseNumber(r.raw.harga ?? ''); if (Number.isNaN(cost) || (cost !== null && cost < 0)) err(r, 'Harga perolehan harus angka >= 0');
      const condition = r.raw.kondisi ? CONDITION[lc(r.raw.kondisi)] : 'GOOD'; if (!condition) err(r, `Kondisi "${r.raw.kondisi}" tidak dikenal`);
      const unit = unitBy.get(up(r.raw.unit ?? '')); if (!unit) err(r, `Kode unit "${r.raw.unit}" tidak ditemukan atau nonaktif`);
      const loc = locBy.get(up(r.raw.lokasi ?? '')); if (!loc) err(r, `Kode lokasi "${r.raw.lokasi}" tidak ditemukan atau nonaktif`);
      const person = r.raw.penanggungJawab ? personBy.get(r.raw.penanggungJawab) : null; if (r.raw.penanggungJawab && !person) err(r, `NIP "${r.raw.penanggungJawab}" tidak ditemukan di Master Data penanggung jawab`);
      const fund = r.raw.sumber ? fundBy.get(up(r.raw.sumber)) : null; if (r.raw.sumber && !fund) err(r, `Kode sumber "${r.raw.sumber}" tidak ditemukan`);
      const vendor = r.raw.vendor ? vendorBy.get(up(r.raw.vendor)) : null; if (r.raw.vendor && !vendor) err(r, `Kode vendor "${r.raw.vendor}" tidak ditemukan`);
      if (item && r.raw.nomorSeri) {
        const k = `${item.id}|${lc(r.raw.nomorSeri)}`;
        if (taken.has(k)) err(r, `Nomor seri ${r.raw.nomorSeri} sudah terdaftar untuk barang ini`);
        else if (inFile.has(k)) err(r, `Nomor seri ${r.raw.nomorSeri} sama dengan baris ${inFile.get(k)}`);
        else inFile.set(k, r.row);
      } else if (item) r.warnings.push('Tanpa nomor seri');
      keep(r, { item, serial: r.raw.nomorSeri || null, year, date, cost: cost ?? 0, condition, unitId: unit?.id, locationId: loc?.id, personId: person?.id ?? null, fundingSourceId: fund?.id ?? null, vendorId: vendor?.id ?? null, notes: r.raw.catatan || null });
    }
    return { results, prepared };
  }

  // opening-stock
  const [items, whs, ledger] = await Promise.all([
    db.item.findMany({ where: { type: 'SUPPLY', isActive: true } }), db.warehouse.findMany({ where: { isActive: true } }),
    db.stockTransactionDetail.groupBy({ by: ['itemId', 'warehouseId'] }),
  ]);
  const itemBy = new Map(items.map((i) => [i.code, i])), whBy = new Map(whs.map((w) => [w.code, w]));
  const hasLedger = new Set(ledger.map((l) => `${l.itemId}|${l.warehouseId}`));
  const inFile = new Map<string, number>();
  for (const r of results) {
    const item = itemBy.get(up(r.raw.kodeBarang ?? '')); if (!item) err(r, `Kode barang "${r.raw.kodeBarang}" tidak ditemukan, nonaktif, atau bukan barang Persediaan`);
    const wh = whBy.get(up(r.raw.gudang ?? '')); if (!wh) err(r, `Kode gudang "${r.raw.gudang}" tidak ditemukan atau nonaktif`);
    const qty = parseNumber(r.raw.jumlah ?? ''); if (qty === null || Number.isNaN(qty) || qty <= 0) err(r, 'Jumlah harus angka lebih dari 0');
    const cost = parseNumber(r.raw.harga ?? ''); if (Number.isNaN(cost) || (cost !== null && cost < 0)) err(r, 'Harga satuan harus angka >= 0');
    const date = parseDate(r.raw.tanggal ?? ''); if (!date) err(r, 'Tanggal saldo wajib diisi dengan format YYYY-MM-DD atau DD/MM/YYYY');
    if (item && wh) {
      const k = `${item.id}|${wh.id}`;
      if (hasLedger.has(k)) err(r, `${item.code} di gudang ${wh.code} sudah memiliki transaksi stok. Saldo awal hanya untuk barang yang belum punya riwayat; gunakan Barang masuk atau Penyesuaian`);
      else if (inFile.has(k)) err(r, `Barang dan gudang yang sama sudah ada di baris ${inFile.get(k)}`);
      else inFile.set(k, r.row);
    }
    keep(r, { item, warehouse: wh, qty, cost, date, notes: r.raw.catatan || null });
  }
  return { results, prepared };
}

export interface CommitCtx { tx: Prisma.TransactionClient; req: FastifyRequest; userId: string }

/** Menulis baris valid. Dipanggil di dalam satu transaksi: gagal satu, seluruh batch dibatalkan. */
export async function commitRows(key: ImportKey, prepared: Prepared[], { tx, req, userId }: CommitCtx): Promise<{ created: number; summary: string[] }> {
  const summary: string[] = [];
  if (key === 'locations') {
    const idByCode = new Map((await tx.location.findMany({ select: { id: true, code: true } })).map((l) => [l.code, l.id]));
    const pending = [...prepared];
    while (pending.length) {
      const before = pending.length;
      for (const p of [...pending]) {
        const parentId = p.data.parentCode ? idByCode.get(p.data.parentCode) : null;
        if (p.data.parentCode && !parentId) continue; // induk belum dibuat, coba putaran berikut
        const loc = await tx.location.create({ data: { code: p.data.code, name: p.data.name, type: p.data.type, parentId: parentId ?? null, unitId: p.data.unitId } });
        idByCode.set(loc.code, loc.id); summary.push(loc.code);
        await writeAudit(tx, req, { action: 'CREATE', entityType: 'Location', entityId: loc.id, after: { code: loc.code, source: 'IMPORT' }, userId });
        pending.splice(pending.indexOf(p), 1);
      }
      if (pending.length === before) throw new Error('Hierarki lokasi tidak dapat diselesaikan');
    }
  } else if (key === 'items') {
    for (const p of prepared) {
      const d = p.data;
      const seq = await nextSequence(tx, `ITEM:${d.type}`);
      const item = await tx.item.create({ data: { code: `${d.type === 'ASSET' ? 'BRG' : 'PRS'}-${d.prefix}-${pad(seq)}`, name: d.name, type: d.type, categoryId: d.categoryId, brandId: d.brandId, model: d.model, specification: d.specification, unitOfMeasureId: d.unitOfMeasureId, minStock: d.minStock, createdById: userId } });
      summary.push(item.code);
      await writeAudit(tx, req, { action: 'CREATE', entityType: 'Item', entityId: item.id, after: { code: item.code, name: item.name, source: 'IMPORT' }, userId });
    }
  } else if (key === 'assets') {
    for (const p of prepared) {
      const d = p.data;
      const [a] = await createAssetUnits(tx, req, { item: d.item, count: 1, serials: [d.serial], acquisitionDate: d.date, acquisitionYear: d.year, fundingSourceId: d.fundingSourceId, vendorId: d.vendorId, acquisitionCost: d.cost, condition: d.condition, unitId: d.unitId, locationId: d.locationId, personId: d.personId, notes: d.notes, userId, note: 'Import Excel' });
      summary.push(a!.code);
    }
  } else {
    // Satu transaksi OPENING per gudang+tanggal, sehingga kartu stok menampilkan "Saldo awal".
    const groups = new Map<string, Prepared[]>();
    for (const p of prepared) { const k = `${p.data.warehouse.id}|${p.data.date.toISOString().slice(0, 10)}`; groups.set(k, [...(groups.get(k) ?? []), p]); }
    for (const rows of groups.values()) {
      const first = rows[0]!.data;
      await postStockTransaction(tx, req, { type: 'OPENING', date: first.date, warehouseId: first.warehouse.id, lines: rows.map((r) => ({ itemId: r.data.item.id, delta: r.data.qty, unitCost: r.data.cost })), sourceType: 'IMPORT', notes: 'Saldo awal (import Excel)', userId });
      rows.forEach((r) => summary.push(r.data.item.code));
    }
  }
  return { created: prepared.length, summary };
}
