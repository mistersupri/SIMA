import type { FastifyInstance } from 'fastify';
import { prisma } from '../../lib/prisma';
import { ok } from '../../lib/respond';

export async function healthRoutes(app: FastifyInstance) {
  app.get('/health', async (_req, reply) => {
    const startedAt = Date.now();
    try {
      await prisma.$queryRaw`SELECT 1`;
    } catch (err) {
      app.log.error({ err }, 'health check: database tidak dapat dijangkau');
      return reply.code(503).send({
        success: false,
        message: 'Database tidak dapat dijangkau',
      });
    }
    return ok(
      { status: 'ok', database: 'up', latencyMs: Date.now() - startedAt, time: new Date().toISOString() },
      'Layanan berjalan',
    );
  });
}
