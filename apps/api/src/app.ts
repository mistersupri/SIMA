import Fastify, { type FastifyError } from 'fastify';
import helmet from '@fastify/helmet';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import { ZodError } from 'zod';
import type { Env } from './config/env';
import { AppError } from './lib/errors';
import { healthRoutes } from './modules/health/routes';
import { authPlugin } from './plugins/auth';
import { authRoutes } from './modules/auth/routes';
import { userRoutes } from './modules/users/routes';
import { roleRoutes } from './modules/roles/routes';
import { masterRoutes } from './modules/master/routes';
import { Prisma } from '@prisma/client';
import { collectRoutes, type RouteInfo } from './docs/routes';
import multipart from '@fastify/multipart';
import { registerWeb } from './plugins/web';
import { itemRoutes } from './modules/items/routes';
import { assetRoutes } from './modules/assets/routes';
import { fileRoutes } from './modules/files/routes';
import { stockRoutes } from './modules/stocks/routes';
import { approvalRoutes } from './modules/approvals/routes';
import { notificationRoutes } from './modules/notifications/routes';
import { procurementRoutes } from './modules/procurements/routes';
import { mutationRoutes } from './modules/mutations/routes';
import { loanRoutes } from './modules/loans/routes';
import { maintenanceRoutes } from './modules/maintenances/routes';
import { disposalRoutes } from './modules/disposals/routes';
import { opnameRoutes } from './modules/opnames/routes';
import { reportRoutes } from './modules/reports/routes';
import { auditRoutes } from './modules/audit/routes';
import { importRoutes } from './modules/imports/routes';
import { settingsRoutes } from './modules/settings/routes';
import { stockAdjustmentRoutes } from './modules/stocks/adjustments';

/** Label Bahasa Indonesia untuk kolom yang bisa bentrok pada unique constraint. */
const FIELD_LABEL: Record<string, string> = {
  code: 'Kode',
  codePrefix: 'Awalan kode',
  name: 'Nama',
  email: 'Email',
  nip: 'NIP',
  number: 'Nomor dokumen',
  serialNumber: 'Nomor seri',
  itemId: 'Barang',
  assetId: 'Aset',
};

export async function buildApp(env: Env, opts: { inventory?: RouteInfo[] } = {}) {
  const app = Fastify({
    logger:
      env.NODE_ENV === 'test'
        ? false
        : {
            level: env.NODE_ENV === 'production' ? 'info' : 'debug',
            redact: ['req.headers.cookie', 'req.headers.authorization'],
          },
    // Di belakang reverse proxy (nginx/Caddy) agar IP klien benar untuk rate limit dan audit.
    trustProxy: env.NODE_ENV === 'production',
    bodyLimit: 2 * 1024 * 1024,
  });

  if (opts.inventory) collectRoutes(app, opts.inventory);
  await app.register(helmet, { contentSecurityPolicy: false });
  await app.register(cookie, { secret: env.SESSION_SECRET });
  // Batas per sesi login (bukan per IP) agar banyak pengguna di balik satu NAT tidak saling menghambat.
  // Permintaan tanpa sesi (login, health) dibatasi per IP.
  await app.register(rateLimit, {
    global: true,
    max: 600,
    timeWindow: '1 minute',
    // File statis web tidak dibatasi; batas hanya untuk API.
    allowList: (req) => !req.url.startsWith('/api/'),
    keyGenerator: (req) => (req.cookies?.sima_sid ? `s:${req.cookies.sima_sid.slice(0, 24)}` : `ip:${req.ip}`),
    errorResponseBuilder: (_req, ctx) => new AppError(429, `Terlalu banyak permintaan. Coba lagi dalam ${Math.ceil(ctx.ttl / 1000)} detik.`, 'RATE_LIMITED'),
  });
  await app.register(multipart, { limits: { fileSize: env.MAX_UPLOAD_MB * 1024 * 1024, files: 1, fields: 5 } });
  await authPlugin(app, env);

  app.setErrorHandler((err: FastifyError | AppError | ZodError, req, reply) => {
    if (err instanceof Prisma.PrismaClientKnownRequestError) {
      if (err.code === 'P2002') {
        const target = (err.meta?.target as string[] | undefined) ?? [];
        const fields = target.length ? target : ['data'];
        return reply.code(409).send({
          success: false,
          message: 'Data dengan nilai yang sama sudah ada',
          errors: fields.map((f) => ({ field: f, message: `${FIELD_LABEL[f] ?? f} sudah dipakai` })),
        });
      }
      if (err.code === 'P2003') return reply.code(409).send({ success: false, message: 'Data terkait tidak valid atau masih dipakai data lain' });
      if (err.code === 'P2025') return reply.code(404).send({ success: false, message: 'Data tidak ditemukan' });
    }
    if (err instanceof ZodError || err.name === 'ZodError') {
      const zerr = err as ZodError;
      return reply.code(400).send({
        success: false,
        message: 'Validasi gagal',
        errors: zerr.issues.map((i) => ({ field: i.path.join('.'), message: i.message })),
      });
    }
    if (err instanceof AppError) {
      return reply
        .code(err.statusCode)
        .send({ success: false, message: err.message, ...(err.errors ? { errors: err.errors } : {}) });
    }
    const status = 'statusCode' in err && typeof err.statusCode === 'number' ? err.statusCode : 500;
    if (status >= 500) {
      req.log.error({ err }, 'kesalahan tidak tertangani');
      return reply.code(500).send({ success: false, message: 'Terjadi kesalahan pada server' });
    }
    return reply.code(status).send({ success: false, message: err.message });
  });

  const spaFallback = env.WEB_DIST ? await registerWeb(app, env.WEB_DIST) : null;
  app.setNotFoundHandler((req, reply) => {
    const html = spaFallback?.(req);
    if (html) return reply.code(200).header('cache-control', 'no-cache').type('text/html; charset=utf-8').send(html);
    return reply.code(404).send({ success: false, message: 'Endpoint tidak ditemukan' });
  });

  await app.register(
    async (api) => {
      await api.register(healthRoutes);
      await api.register(authRoutes);
      await api.register(userRoutes);
      await api.register(roleRoutes);
      await api.register(masterRoutes);
      await api.register(itemRoutes);
      await api.register(assetRoutes);
      await api.register(fileRoutes);
      await api.register(stockRoutes);
      await api.register(approvalRoutes);
      await api.register(notificationRoutes);
      await api.register(procurementRoutes);
      await api.register(mutationRoutes);
      await api.register(loanRoutes);
      await api.register(maintenanceRoutes);
      await api.register(disposalRoutes);
      await api.register(opnameRoutes);
      await api.register(reportRoutes);
      await api.register(auditRoutes);
      await api.register(importRoutes);
      await api.register(settingsRoutes);
      await api.register(stockAdjustmentRoutes);
    },
    { prefix: '/api/v1' },
  );

  return app;
}
