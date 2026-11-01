import type { FastifyInstance } from 'fastify';
import { uuid } from '@sima/shared';
import { prisma } from '../../lib/prisma';
import { notFound } from '../../lib/errors';
import { readStoredFile } from '../../lib/storage';
import { currentUser, authenticate } from '../../plugins/auth';
import { forbidden } from '../../lib/errors';

/** File privat: hanya dapat diakses lewat endpoint ini oleh pengguna yang berhak melihat aset/pemeriksaan. */
export async function fileRoutes(app: FastifyInstance) {
  app.get('/files/:id', { preHandler: authenticate }, async (req, reply) => {
    const auth = currentUser(req);
    if (!auth.permissions.has('assets.view') && !auth.permissions.has('stock_opnames.view')) throw forbidden();
    const file = await prisma.file.findUnique({ where: { id: uuid('File').parse((req.params as { id: string }).id) } });
    if (!file) throw notFound('File tidak ditemukan');
    const buffer = await readStoredFile(app.config, file.storageKey).catch(() => null);
    if (!buffer) throw notFound('File tidak ditemukan di penyimpanan');
    return reply
      .header('content-type', file.mimeType)
      .header('x-content-type-options', 'nosniff')
      .header('content-disposition', `inline; filename="${encodeURIComponent(file.originalName)}"`)
      .header('cache-control', 'private, max-age=3600')
      .send(buffer);
  });
}
