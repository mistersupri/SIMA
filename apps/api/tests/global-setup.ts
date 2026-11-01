import { execSync } from 'node:child_process';

// Menyiapkan skema database test (DATABASE_URL berasal dari .env.test).
export default function setup() {
  if (!process.env.DATABASE_URL?.includes('_test')) {
    throw new Error('Test hanya boleh berjalan pada database dengan akhiran _test.');
  }
  execSync('pnpm exec prisma migrate deploy', { stdio: 'inherit', env: process.env });
}
