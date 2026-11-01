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
import multipart from '@fastify/multipart';
import { itemRoutes } from './modules/items/routes';
import { assetRoutes } from './modules/assets/routes';
import { fileRoutes } from './modules/files/routes';
import { stockRoutes } from './modules/stocks/routes';
import { approvalRoutes } from './modules/approvals/routes';
import { notificationRoutes } from './modules/notifications/routes';
import { procurementRoutes } from './modules/procurements/routes';
import { mutationRoutes } from './modules/mutations/routes';
import { loanRoutes } from './modules/loans/routes';
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

export async function buildApp(env: Env) {
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

  await app.register(helmet, { contentSecurityPolicy: false });
  await app.register(cookie, { secret: env.SESSION_SECRET });
  await app.register(rateLimit, { global: true, max: 300, timeWindow: '1 minute' });
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

  app.setNotFoundHandler((_req, reply) =>
    reply.code(404).send({ success: false, message: 'Endpoint tidak ditemukan' }),
  );

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
      await api.register(stockAdjustmentRoutes);
    },
    { prefix: '/api/v1' },
  );

  return app;
}
