import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createFixture, db, resetDb } from './helpers';

const deployDir = path.resolve(__dirname, '../../../deploy');
const hasPgTools = ['pg_dump', 'pg_restore', 'psql', 'createdb', 'dropdb'].every((c) => spawnSync(c, ['--version']).status === 0);

const url = new URL(process.env.DATABASE_URL!);
const baseEnv = {
  ...process.env,
  PGHOST: url.hostname, PGPORT: url.port || '5432', PGUSER: decodeURIComponent(url.username), PGPASSWORD: decodeURIComponent(url.password),
};
const restoredDb = `sima_restore_${process.pid}`;
const run = (script: string, args: string[], env: Record<string, string>) =>
  spawnSync('sh', [path.join(deployDir, script), ...args], { env: { ...baseEnv, ...env }, encoding: 'utf8' });
const psql = (database: string, sql: string) =>
  spawnSync('psql', ['-d', database, '-Atqc', sql], { env: baseEnv, encoding: 'utf8' }).stdout.trim();

/** Jumlah baris setiap tabel di skema public, untuk perbandingan sumber vs hasil restore. */
function rowCounts(database: string) {
  const tables = psql(database, "SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY 1").split('\n');
  const sql = tables.map((t) => `SELECT '${t}', count(*) FROM "${t}"`).join(' UNION ALL ');
  return Object.fromEntries(psql(database, sql).split('\n').map((l) => l.split('|')));
}

describe.skipIf(!hasPgTools)('backup dan restore (skrip deploy/backup.sh dan restore.sh)', () => {
  const work = mkdtempSync(path.join(tmpdir(), 'sima-bk-'));
  const storage = path.join(work, 'storage');
  const backups = path.join(work, 'backups');
  const sourceDb = url.pathname.slice(1);
  let backupPath = '';

  beforeAll(async () => {
    await resetDb();
    await createFixture();
    await createFixture();
    await db.auditLog.create({ data: { action: 'CREATE', entityType: 'Uji', entityId: 'x' } });
    mkdirSync(path.join(storage, 'assets'), { recursive: true });
    writeFileSync(path.join(storage, 'assets', 'foto.txt'), 'isi-berkas-privat');
  });
  afterAll(async () => {
    spawnSync('dropdb', ['--if-exists', restoredDb], { env: baseEnv });
    rmSync(work, { recursive: true, force: true });
    await db.$disconnect();
  });

  it('backup membuat dump, arsip file, checksum, dan manifest yang lolos verifikasi', () => {
    const r = run('backup.sh', [], { PGDATABASE: sourceDb, STORAGE_DIR: storage, BACKUP_DIR: backups });
    expect(r.status, r.stderr + r.stdout).toBe(0);
    const dirs = spawnSync('sh', ['-c', `ls -1d ${backups}/sima-*`], { encoding: 'utf8' }).stdout.trim().split('\n');
    expect(dirs).toHaveLength(1);
    backupPath = dirs[0]!;
    for (const f of ['db.dump', 'storage.tar.gz', 'SHA256SUMS', 'MANIFEST']) expect(existsSync(path.join(backupPath, f))).toBe(true);
    expect(spawnSync('sha256sum', ['-c', 'SHA256SUMS'], { cwd: backupPath }).status).toBe(0);
  });

  it('backup gagal (exit non-zero) dan tidak meninggalkan folder setengah jadi bila database tidak ada', () => {
    const before = readFileSync(path.join(backupPath, 'MANIFEST'), 'utf8');
    const r = run('backup.sh', [], { PGDATABASE: 'database_tidak_ada', STORAGE_DIR: storage, BACKUP_DIR: backups });
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/GAGAL/);
    expect(spawnSync('sh', ['-c', `ls -1d ${backups}/sima-* | wc -l`], { encoding: 'utf8' }).stdout.trim()).toBe('1');
    expect(readFileSync(path.join(backupPath, 'MANIFEST'), 'utf8')).toBe(before);
  });

  it('restore ke database baru menghasilkan data dan file yang identik', () => {
    const restoredStorage = path.join(work, 'storage-restored');
    const r = run('restore.sh', [backupPath, '--yes'], { PGDATABASE: restoredDb, STORAGE_DIR: restoredStorage });
    expect(r.status, r.stderr + r.stdout).toBe(0);
    const src = rowCounts(sourceDb);
    const dst = rowCounts(restoredDb);
    expect(Number(src.assets)).toBeGreaterThanOrEqual(2);
    expect(dst).toEqual(src);
    expect(readFileSync(path.join(restoredStorage, 'assets', 'foto.txt'), 'utf8')).toBe('isi-berkas-privat');
  });

  it('batasan integritas tetap aktif pada hasil restore (trigger append-only, CHECK, index parsial)', () => {
    const q = (sql: string) => spawnSync('psql', ['-d', restoredDb, '-Atqc', sql], { env: baseEnv, encoding: 'utf8' });
    expect(psql(restoredDb, "SELECT count(*) FROM audit_logs")).toBe('1');
    expect(psql(restoredDb, "SELECT count(*) FROM pg_trigger WHERE tgrelid='audit_logs'::regclass AND NOT tgisinternal")).not.toBe('0');
    const upd = q("UPDATE audit_logs SET action='X'");
    expect(upd.status).not.toBe(0);
    expect(upd.stderr).toMatch(/sima_prevent_mutation|tidak|append|diubah/i);
    expect(q("DELETE FROM audit_logs").status).not.toBe(0);
    expect(psql(restoredDb, "SELECT count(*) FROM pg_constraint WHERE conname='stock_balances_quantity_non_negative'")).toBe('1');
    expect(psql(restoredDb, "SELECT count(*) FROM pg_indexes WHERE indexdef ILIKE '%WHERE%' AND tablename='loan_details'")).not.toBe('0');
  });

  it('restore menolak database tujuan yang sudah berisi data tanpa --force', () => {
    const r = run('restore.sh', [backupPath, '--yes'], { PGDATABASE: restoredDb, STORAGE_DIR: path.join(work, 's2') });
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/--force/);
  });

  it('restore menolak backup yang checksum-nya tidak cocok (berkas rusak)', () => {
    const rusak = path.join(work, 'rusak');
    spawnSync('cp', ['-r', backupPath, rusak]);
    writeFileSync(path.join(rusak, 'db.dump'), 'bukan dump', { flag: 'a' });
    const r = run('restore.sh', [rusak, '--yes'], { PGDATABASE: `${restoredDb}_x`, STORAGE_DIR: path.join(work, 's3') });
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/checksum/);
    expect(psql('postgres', `SELECT count(*) FROM pg_database WHERE datname='${restoredDb}_x'`)).toBe('0');
  });

  it('tanpa --yes restore meminta konfirmasi dan membatalkan jawaban selain PULIHKAN', () => {
    const r = spawnSync('sh', [path.join(deployDir, 'restore.sh'), backupPath, '--force'], {
      env: { ...baseEnv, PGDATABASE: restoredDb, STORAGE_DIR: path.join(work, 's4') }, input: 'tidak\n', encoding: 'utf8',
    });
    expect(r.status).not.toBe(0);
    expect(r.stdout).toMatch(/dibatalkan/);
  });

  it('retensi menghapus backup harian lama melebihi KEEP_DAILY', () => {
    for (let i = 0; i < 3; i++) {
      const r = run('backup.sh', [], { PGDATABASE: sourceDb, STORAGE_DIR: storage, BACKUP_DIR: backups, KEEP_DAILY: '2' });
      expect(r.status, r.stderr).toBe(0);
      spawnSync('sleep', ['1']); // nama folder memakai detik
    }
    expect(spawnSync('sh', ['-c', `ls -1d ${backups}/sima-* | wc -l`], { encoding: 'utf8' }).stdout.trim()).toBe('2');
  });
});
