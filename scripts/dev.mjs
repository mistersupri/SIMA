/**
 * `pnpm dev`: satu perintah untuk seluruh lingkungan lokal.
 *  1. Membuat .env bila belum ada
 *  2. Menyalakan PostgreSQL (Docker Compose), atau memakai database yang sudah menyala di DATABASE_URL
 *  3. Build paket shared, prisma generate, migrate deploy, seed (idempoten)
 *  4. Menjalankan shared (watch), API, dan web secara paralel
 */
import { existsSync } from 'node:fs';
import path from 'node:path';
import { ensureEnvFile, readEnv, run, fail, log, dockerAvailable, canConnect, startProcess, root } from './lib.mjs';

ensureEnvFile();
const env = readEnv();

if (!existsSync(path.join(root, 'node_modules'))) {
  log('Menginstal dependensi…');
  if (run('pnpm', ['install']) !== 0) fail('pnpm install gagal.');
}

const dbUrl = new URL(env.DATABASE_URL);
const dbHost = dbUrl.hostname;
const dbPort = Number(dbUrl.port || 5432);

if (await canConnect(dbHost, dbPort)) {
  log(`Database sudah menyala di ${dbHost}:${dbPort}, dipakai langsung.`);
} else if (dockerAvailable()) {
  log('Menyalakan PostgreSQL (Docker Compose)…');
  if (run('docker', ['compose', 'up', '-d', '--wait', 'db']) !== 0) fail('Gagal menyalakan database.');
} else {
  fail(
    `Database tidak dapat dijangkau di ${dbHost}:${dbPort} dan Docker tidak berjalan.\n` +
      '  Jalankan Docker, atau nyalakan PostgreSQL sendiri sesuai DATABASE_URL di .env.',
  );
}

log('Menyiapkan paket shared dan database…');
const steps = [
  ['pnpm', ['--filter', '@sima/shared', 'build']],
  ['pnpm', ['--filter', '@sima/api', 'db:generate']],
  ['pnpm', ['--filter', '@sima/api', 'db:deploy']],
  ['pnpm', ['--filter', '@sima/api', 'db:seed']],
];
for (const [cmd, args] of steps) {
  if (run(cmd, args) !== 0) fail(`Langkah gagal: ${cmd} ${args.join(' ')}`);
}

const children = [];
startProcess('shared', '35', 'pnpm', ['--filter', '@sima/shared', 'dev'], children);
startProcess('api', '33', 'pnpm', ['--filter', '@sima/api', 'dev'], children);
startProcess('web', '32', 'pnpm', ['--filter', '@sima/web', 'dev'], children);

log(`Web  : http://localhost:${env.WEB_PORT ?? 5173}`);
log(`API  : http://localhost:${env.API_PORT ?? 3001}/api/v1/health`);
log(`Login: ${env.BOOTSTRAP_ADMIN_EMAIL} (password dari BOOTSTRAP_ADMIN_PASSWORD di .env)`);

let stopping = false;
const stop = () => {
  if (stopping) return;
  stopping = true;
  for (const c of children) c.kill('SIGTERM');
  setTimeout(() => process.exit(0), 500);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
for (const c of children) {
  c.on('exit', (code) => {
    if (!stopping && code) {
      console.error(`Proses berhenti dengan kode ${code}, menghentikan semua.`);
      stop();
    }
  });
}
