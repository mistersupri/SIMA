import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { ROLE_CODES, uuid } from '@sima/shared';
import { prisma } from '../../lib/prisma';
import { ok, paginated } from '../../lib/respond';
import { AppError, badRequest, conflict, forbidden, notFound, unprocessable } from '../../lib/errors';
import { writeAudit } from '../../lib/audit';
import { lockRows } from '../../lib/doc';
import { authenticate, currentUser, type AuthContext } from '../../plugins/auth';
import { parseWorkbook } from './parse';
import { commitRows, validateRows } from './process';
import { buildErrorReport, buildTemplate } from './template';
import { COLUMNS, IMPORT_DB_TYPE, IMPORT_LABEL, IMPORT_PERMISSION, type ImportKey, type RawRow, type RowResult } from './types';

const TTL_MS = 24 * 3600 * 1000;
const keySchema = z.enum(['items', 'assets', 'locations', 'opening-stock']);
interface Payload { rows: { row: number; raw: RawRow; errors: string[]; warnings: string[]; commitErrors?: string[] }[]; ignoredColumns: string[] }

function requireType(auth: AuthContext, key: ImportKey) {
  if (!auth.permissions.has(IMPORT_PERMISSION[key])) throw forbidden(`Anda tidak memiliki izin import ${IMPORT_LABEL[key]}`);
}
const shape = (r: Payload['rows'][number]) => ({ row: r.row, status: r.errors.length || r.commitErrors?.length ? ('error' as const) : ('valid' as const), errors: [...r.errors, ...(r.commitErrors ?? [])], warnings: r.warnings, values: r.raw });

async function loadBatch(req: FastifyRequest, id: string) {
  const b = await prisma.importBatch.findUnique({ where: { id } });
  if (!b) throw notFound('Batch import tidak ditemukan');
  const auth = currentUser(req);
  const key = (Object.entries(IMPORT_DB_TYPE).find(([, v]) => v === b.type)![0]) as ImportKey;
  requireType(auth, key);
  if (b.createdById !== auth.user.id && !auth.roleCodes.has(ROLE_CODES.SUPER_ADMIN)) throw forbidden('Batch ini dibuat pengguna lain');
  return { b, key, payload: b.payload as unknown as Payload };
}

export async function importRoutes(app: FastifyInstance) {
  const env = app.config;

  app.get('/imports/types', { preHandler: authenticate }, async (req) => {
    const auth = currentUser(req);
    return ok((Object.keys(COLUMNS) as ImportKey[]).filter((k) => auth.permissions.has(IMPORT_PERMISSION[k])).map((k) => ({ key: k, label: IMPORT_LABEL[k], columns: COLUMNS[k] })));
  });

  app.get('/imports/template', { preHandler: authenticate }, async (req, reply) => {
    const key = keySchema.parse((req.query as { type?: string }).type);
    requireType(currentUser(req), key);
    return reply
      .header('content-type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
      .header('content-disposition', `attachment; filename="template-impor-${key}.xlsx"`)
      .send(await buildTemplate(key));
  });

  app.post('/imports/:type/preview', { preHandler: authenticate }, async (req) => {
    const key = keySchema.parse((req.params as { type: string }).type);
    const auth = currentUser(req);
    requireType(auth, key);
    const part = await req.file();
    if (!part) throw badRequest('File Excel wajib dilampirkan');
    let buffer: Buffer;
    try { buffer = await part.toBuffer(); } catch { throw new AppError(413, `Ukuran file melebihi ${env.MAX_UPLOAD_MB} MB`, 'FILE_TOO_LARGE'); }
    const { rows, ignoredColumns } = await parseWorkbook(buffer, key);
    const { results } = await validateRows(prisma, key, rows);
    const errorRows = results.filter((r) => r.errors.length).length;
    const batch = await prisma.importBatch.create({
      data: { type: IMPORT_DB_TYPE[key], fileName: part.filename.replace(/[^\w.\- ()]/g, '_').slice(0, 150), totalRows: results.length, validRows: results.length - errorRows, errorRows, payload: { rows: results.map(({ row, raw, errors, warnings }) => ({ row, raw, errors, warnings })), ignoredColumns } as never, createdById: auth.user.id },
    });
    await writeAudit(prisma, req, { action: 'IMPORT_PREVIEW', entityType: 'Import', entityId: batch.id, after: { type: key, file: batch.fileName, total: batch.totalRows, errors: errorRows } });
    const shown = [...results.filter((r) => r.errors.length), ...results.filter((r) => !r.errors.length)].slice(0, 300);
    return ok({
      batchId: batch.id, type: key, fileName: batch.fileName, total: batch.totalRows, valid: batch.validRows, errors: errorRows, withWarnings: results.filter((r) => !r.errors.length && r.warnings.length).length,
      ignoredColumns, expiresAt: new Date(batch.createdAt.getTime() + TTL_MS), truncated: results.length > shown.length,
      rows: shown.map((r) => shape(r as Payload['rows'][number])),
    }, 'File dibaca. Periksa hasil sebelum mengimpor.');
  });

  app.get('/imports/batches/:id/rows', { preHandler: authenticate }, async (req) => {
    const { payload } = await loadBatch(req, uuid().parse((req.params as { id: string }).id));
    const q = req.query as { status?: string; page?: string; limit?: string };
    const page = Math.max(1, Number(q.page) || 1), limit = Math.min(200, Math.max(1, Number(q.limit) || 50));
    const all = payload.rows.map(shape).filter((r) => (q.status === 'error' || q.status === 'valid' ? r.status === q.status : true));
    return paginated(all.slice((page - 1) * limit, page * limit), all.length, page, limit);
  });

  app.get('/imports/batches/:id/errors', { preHandler: authenticate }, async (req, reply) => {
    const { b, key, payload } = await loadBatch(req, uuid().parse((req.params as { id: string }).id));
    const bad = payload.rows.filter((r) => r.errors.length || r.commitErrors?.length).map((r) => ({ row: r.row, raw: r.raw, errors: [...r.errors, ...(r.commitErrors ?? [])] }));
    return reply
      .header('content-type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
      .header('content-disposition', `attachment; filename="kesalahan-impor-${key}-${b.createdAt.toISOString().slice(0, 10)}.xlsx"`)
      .send(await buildErrorReport(key, bad));
  });

  app.post('/imports/:type/commit', { preHandler: authenticate }, async (req) => {
    const key = keySchema.parse((req.params as { type: string }).type);
    const auth = currentUser(req);
    requireType(auth, key);
    const { batchId, skipErrors } = z.object({ batchId: z.string().uuid('Batch tidak valid'), skipErrors: z.boolean().default(false) }).parse(req.body);

    // Kedaluwarsa dicatat di luar transaksi commit agar statusnya tidak ikut di-rollback.
    const pre = await prisma.importBatch.findUnique({ where: { id: batchId } });
    if (pre && pre.status === 'PREVIEWED' && Date.now() - pre.createdAt.getTime() > TTL_MS) {
      await prisma.importBatch.update({ where: { id: batchId }, data: { status: 'EXPIRED' } });
      throw unprocessable('Preview sudah kedaluwarsa (lebih dari 24 jam). Unggah ulang file.');
    }
    const result = await prisma.$transaction(async (tx) => {
      await lockRows(tx, 'import_batches', [batchId]);
      const b = await tx.importBatch.findUnique({ where: { id: batchId } });
      if (!b || b.type !== IMPORT_DB_TYPE[key]) throw notFound('Batch import tidak ditemukan');
      if (b.createdById !== auth.user.id && !auth.roleCodes.has(ROLE_CODES.SUPER_ADMIN)) throw forbidden('Batch ini dibuat pengguna lain');
      if (b.status !== 'PREVIEWED') throw conflict('Batch ini sudah diimpor atau kedaluwarsa. Unggah ulang file.');
      if (Date.now() - b.createdAt.getTime() > TTL_MS) throw unprocessable('Preview sudah kedaluwarsa (lebih dari 24 jam). Unggah ulang file.');
      const payload = b.payload as unknown as Payload;
      if (b.errorRows > 0 && !skipErrors) throw unprocessable(`${b.errorRows} baris bermasalah. Perbaiki file lalu unggah ulang, atau konfirmasi untuk melewati baris bermasalah.`);

      // Validasi ulang baris yang lolos preview terhadap kondisi database saat ini (di dalam transaksi).
      const candidates = payload.rows.filter((r) => !r.errors.length);
      const { results, prepared } = await validateRows(tx, key, candidates.map((r) => ({ row: r.row, raw: r.raw })));
      const stale = results.filter((r: RowResult) => r.errors.length);
      if (stale.length && !skipErrors) throw conflict(`Data berubah sejak preview: ${stale.length} baris kini bermasalah. Unggah ulang file untuk memeriksa ulang.`);
      for (const s of stale) payload.rows.find((r) => r.row === s.row)!.commitErrors = s.errors;

      const done = await commitRows(key, prepared, { tx, req, userId: auth.user.id });
      const skipped = payload.rows.filter((r) => r.errors.length || r.commitErrors?.length).map((r) => ({ row: r.row, errors: [...r.errors, ...(r.commitErrors ?? [])] }));
      const res = { created: done.created, skipped: skipped.length, skippedRows: skipped.slice(0, 200), codes: done.summary.slice(0, 200) };
      await tx.importBatch.update({ where: { id: b.id }, data: { status: 'COMMITTED', committedAt: new Date(), result: res as never, payload: payload as never } });
      await writeAudit(tx, req, { action: 'IMPORT', entityType: 'Import', entityId: b.id, after: { type: key, file: b.fileName, created: done.created, skipped: skipped.length } });
      return res;
    }, { timeout: 120_000, maxWait: 10_000 });
    return ok(result, `${result.created} baris berhasil diimpor${result.skipped ? `, ${result.skipped} dilewati` : ''}`);
  });
}
