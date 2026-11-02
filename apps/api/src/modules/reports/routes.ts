import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { ok, paginated } from '../../lib/respond';
import { forbidden, notFound } from '../../lib/errors';
import { writeAudit } from '../../lib/audit';
import { currentUser, requirePermission, type AuthContext } from '../../plugins/auth';
import { REPORTS, reportByKey, type Filters } from './definitions';
import { buildPdf, buildXlsx } from './export';
import { dashboardData } from './dashboard';

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Format tanggal harus YYYY-MM-DD').optional();
const uuidOpt = z.string().uuid().optional();
const filterSchema = z.object({
  from: date, to: date, year: z.coerce.number().int().min(1950).max(2100).optional(),
  categoryId: uuidOpt, locationId: uuidOpt, unitId: uuidOpt, warehouseId: uuidOpt,
  condition: z.enum(['GOOD', 'MINOR_DAMAGE', 'MAJOR_DAMAGE']).optional(), status: z.string().max(30).optional(),
});

/** Export dibatasi oleh reports.export, atau izin export modul untuk laporan inventaris dan persediaan. */
const canExport = (auth: AuthContext, key: string) =>
  auth.permissions.has('reports.export') || (key === 'assets' && auth.permissions.has('assets.export')) || (key === 'stocks' && auth.permissions.has('stocks.export'));

const filterText = (f: Filters) => {
  const parts = Object.entries(f).filter(([, v]) => v !== undefined && v !== '').map(([k, v]) => `${k}: ${v}`);
  return parts.length ? `Filter: ${parts.join(', ')}` : 'Tanpa filter';
};

export async function reportRoutes(app: FastifyInstance) {
  app.get('/reports/dashboard', { preHandler: requirePermission('dashboard.view') }, async (req) => ok(await dashboardData(currentUser(req))));

  app.get('/reports', { preHandler: requirePermission('reports.view') }, async () =>
    ok(REPORTS.map((r) => ({ key: r.key, title: r.title, description: r.description, filters: r.filters, columns: r.columns }))));

  app.get('/reports/:key', { preHandler: requirePermission('reports.view') }, async (req) => {
    const def = reportByKey((req.params as { key: string }).key);
    if (!def) throw notFound('Laporan tidak ditemukan');
    const q = req.query as Record<string, string>;
    const filters = filterSchema.parse(q);
    const page = Math.max(1, Number(q.page) || 1), limit = Math.min(100, Math.max(1, Number(q.limit) || 20));
    const result = await def.fetch(filters, currentUser(req));
    const slice = result.rows.slice((page - 1) * limit, page * limit);
    return { ...paginated(slice, result.rows.length, page, limit), columns: def.columns, summary: result.summary ?? [], title: def.title };
  });

  app.get('/exports/:key', { preHandler: requirePermission('reports.view') }, async (req, reply) => {
    const auth = currentUser(req);
    const key = (req.params as { key: string }).key;
    const def = reportByKey(key);
    if (!def) throw notFound('Laporan tidak ditemukan');
    if (!canExport(auth, key)) throw forbidden('Anda tidak memiliki izin export laporan');
    const q = req.query as Record<string, string>;
    const format = q.format === 'pdf' ? 'pdf' : 'xlsx';
    const filters = filterSchema.parse(q);
    const result = await def.fetch(filters, auth);
    const meta = { title: def.title, filterText: filterText(filters), generatedBy: auth.user.name, generatedAt: new Date() };
    const file = format === 'pdf' ? await buildPdf(def.columns, result, meta) : await buildXlsx(def.columns, result, meta);
    await writeAudit(prisma, req, { action: 'EXPORT', entityType: 'Report', entityId: key, after: { format, rows: result.rows.length, filters } });
    return reply
      .header('content-type', format === 'pdf' ? 'application/pdf' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
      .header('content-disposition', `attachment; filename="laporan-${key}-${new Date().toISOString().slice(0, 10)}.${format}"`)
      .header('cache-control', 'no-store')
      .send(file);
  });
}
