import { loadEnv } from './config/env';
import { buildApp } from './app';
import { prisma } from './lib/prisma';

const env = loadEnv();
const app = await buildApp(env);

const shutdown = async (signal: string) => {
  app.log.info({ signal }, 'menutup server');
  await app.close();
  await prisma.$disconnect();
  process.exit(0);
};
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

try {
  await app.listen({ port: env.API_PORT, host: env.API_HOST });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
