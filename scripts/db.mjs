import { ensureEnvFile, run, fail, dockerAvailable, log } from './lib.mjs';

const action = process.argv[2];
ensureEnvFile();
if (!dockerAvailable()) fail('Docker tidak berjalan. Jalankan Docker Desktop/daemon terlebih dahulu.');

if (action === 'up') {
  log('Menyalakan PostgreSQL (Docker Compose)…');
  process.exit(run('docker', ['compose', 'up', '-d', '--wait', 'db']));
} else if (action === 'down') {
  process.exit(run('docker', ['compose', 'stop', 'db']));
} else {
  fail('Gunakan: node scripts/db.mjs up|down');
}
