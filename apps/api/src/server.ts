import { loadEnv } from './config/env';
import { buildApp } from './app';
import { prisma } from './lib/prisma';
import { sweepLoans } from './modules/loans/service';

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

// Pemeriksaan keterlambatan peminjaman: sekali saat start, lalu tiap jam.
const runSweep = () => sweepLoans().catch((err) => app.log.error({ err }, 'sweep peminjaman gagal'));
void runSweep();
const sweepTimer = setInterval(runSweep, 60 * 60 * 1000);
sweepTimer.unref();

try {
  await app.listen({ port: env.API_PORT, host: env.API_HOST });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
