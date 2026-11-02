import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { ROLE_DEFINITIONS } from '@sima/shared';
import { buildApp } from '../src/app';
import { loadEnv } from '../src/config/env';
import { renderApiDocs } from '../src/docs/generate';
import type { RouteInfo } from '../src/docs/routes';
import { readStoredFile } from '../src/lib/storage';
import { seedBase, sessionFor, call, type Session } from './app-helpers';
import { db, resetDb } from './helpers';

const inventory: RouteInfo[] = [];
let app: Awaited<ReturnType<typeof buildApp>>;
let viewer: Session, root: Session;

/** Satu-satunya route tanpa login. Route baru yang tidak dilindungi membuat test ini gagal. */
const PUBLIC = new Set(['GET /api/v1/health', 'GET /api/v1/app-info', 'POST /api/v1/auth/login', 'POST /api/v1/auth/forgot-password', 'POST /api/v1/auth/reset-password']);
/** Route yang hanya butuh login dan berefek ke sesi sendiri (tidak dipanggil dengan sesi uji yang dipakai bersama). */
/** Diputuskan di service (isEligible + pemisahan tugas), bukan di preHandler; diuji di procurement.test.ts dan monitoring.test.ts. */
const SERVICE_AUTHZ = new Set(['POST /api/v1/approvals/:id/approve', 'POST /api/v1/approvals/:id/reject']);
const SELF_ONLY = new Set(['POST /api/v1/auth/logout', 'POST /api/v1/auth/change-password']);
const UUID = '11111111-1111-4111-8111-111111111111';
const fill = (url: string) => url.replace(/:([A-Za-z]+)/g, (_, n: string) => (/id$/i.test(n) ? UUID : 'x'));
const key = (r: RouteInfo) => `${r.method} ${r.url}`;

beforeAll(async () => {
  await resetDb();
  await seedBase();
  app = await buildApp(loadEnv(), { inventory });
  await app.ready();
  viewer = (await sessionFor('VIEWER')).session;
  root = (await sessionFor('SUPER_ADMIN')).session;
});
afterAll(async () => { await app.close(); await db.$disconnect(); });

const send = (r: RouteInfo, s?: Session, opts: { csrf?: boolean } = {}) =>
  app.inject({
    method: r.method as 'GET', url: fill(r.url),
    headers: { ...(s ? { cookie: s.cookie } : {}), ...(s && opts.csrf !== false ? { 'x-csrf-token': s.csrf } : {}) },
    ...(r.method === 'GET' ? {} : { payload: {} }),
  });

describe('inventaris route', () => {
  it('route terdaftar dan terkumpul', () => {
    expect(inventory.length).toBeGreaterThan(150);
    expect(new Set(inventory.map(key)).size).toBe(inventory.length); // tidak ada duplikat
  });

  it('hanya route yang di-whitelist yang dapat diakses tanpa login', () => {
    const open = inventory.filter((r) => !r.auth).map(key).sort();
    expect(open).toEqual([...PUBLIC].sort());
  });

  it('SEMUA route terproteksi menjawab 401 tanpa login (kecuali whitelist publik)', async () => {
    const failures: string[] = [];
    for (const r of inventory.filter((x) => x.auth)) {
      const res = await send(r);
      if (res.statusCode !== 401) failures.push(`${key(r)} -> ${res.statusCode}`);
    }
    expect(failures).toEqual([]);
  });
});

describe('RBAC di setiap route', () => {
  it('Viewer: route yang butuh permission yang tidak dimilikinya SELALU 403; yang dimilikinya tidak 403', async () => {
    const have = new Set(ROLE_DEFINITIONS.find((r) => r.code === 'VIEWER')!.permissions as string[]);
    const wrong: string[] = [];
    let forbidden = 0, allowed = 0;
    for (const r of inventory.filter((x) => x.auth && x.permissions.length && !SELF_ONLY.has(key(x)))) {
      const res = await send(r, viewer);
      const shouldBlock = r.permissions.some((p) => !have.has(p));
      if (shouldBlock) { forbidden++; if (res.statusCode !== 403) wrong.push(`${key(r)} seharusnya 403, dapat ${res.statusCode}`); }
      else { allowed++; if (res.statusCode === 403 || res.statusCode === 401) wrong.push(`${key(r)} seharusnya diizinkan, dapat ${res.statusCode}`); }
    }
    expect(wrong).toEqual([]);
    expect(forbidden).toBeGreaterThan(85); // sebagian besar route mengubah data atau butuh izin lain
    expect(allowed).toBeGreaterThan(30);
  });

  it('Viewer tidak memiliki izin mengubah data pada route mana pun', () => {
    const mutating = inventory.filter((r) => r.method !== 'GET' && r.auth && r.permissions.length && !SERVICE_AUTHZ.has(key(r)));
    const have = new Set(ROLE_DEFINITIONS.find((r) => r.code === 'VIEWER')!.permissions as string[]);
    expect(mutating.filter((r) => r.permissions.every((p) => have.has(p))).map(key)).toEqual([]);
  });
});

describe('CSRF di setiap route', () => {
  it('semua route non-GET yang butuh login menolak permintaan tanpa token CSRF (403) walau sesi sah', async () => {
    const failures: string[] = [];
    let n = 0;
    for (const r of inventory.filter((x) => x.auth && x.method !== 'GET')) {
      n++;
      const res = await send(r, root, { csrf: false });
      if (res.statusCode !== 403 || !/CSRF/.test(res.json().message)) failures.push(`${key(r)} -> ${res.statusCode}`);
    }
    expect(failures).toEqual([]);
    expect(n).toBeGreaterThan(80);
    // sesi masih hidup: tidak ada efek samping
    expect((await call('GET', '/auth/me', { session: root })).status).toBe(200);
  });
});

describe('konfigurasi produksi dan file', () => {
  it('produksi menolak cookie tidak aman dan secret contoh', () => {
    const base = { ...process.env, NODE_ENV: 'production', SESSION_SECRET: 'x'.repeat(40) };
    expect(() => loadEnv({ ...base, COOKIE_SECURE: 'false' })).toThrow(/COOKIE_SECURE/);
    expect(() => loadEnv({ ...base, COOKIE_SECURE: 'true', SESSION_SECRET: 'ganti-dengan-string-acak-minimal-32-karakter' })).toThrow(/SESSION_SECRET/);
    expect(() => loadEnv({ ...base, COOKIE_SECURE: 'true' })).not.toThrow();
    expect(() => loadEnv({ ...base, COOKIE_SECURE: 'true', SESSION_SECRET: 'pendek' })).toThrow(/32/);
  });

  it('penyimpanan file menolak path traversal', async () => {
    await expect(readStoredFile(loadEnv(), '../../.env')).rejects.toThrow();
    await expect(readStoredFile(loadEnv(), '/etc/passwd')).rejects.toThrow();
  });

  it('respons membawa header keamanan dasar dan tidak membocorkan stack error', async () => {
    const ok = await app.inject({ method: 'GET', url: '/api/v1/health' });
    expect(ok.headers['x-content-type-options']).toBe('nosniff');
    expect(ok.headers['x-frame-options']).toBeDefined();
    expect(ok.headers['strict-transport-security']).toBeDefined();
    expect(ok.headers['x-powered-by']).toBeUndefined();
    const bad = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: '{bukan json', headers: { 'content-type': 'application/json' } });
    expect(bad.statusCode).toBe(400);
    expect(bad.body).not.toMatch(/at .*\.(ts|js):\d+/);
  });
});

describe('dokumentasi API', () => {
  it('docs/API.md sama persis dengan route yang terdaftar (jalankan `pnpm docs:api` bila gagal)', () => {
    const file = readFileSync(path.resolve(__dirname, '../../../docs/API.md'), 'utf8');
    expect(file).toBe(renderApiDocs(inventory));
  });
});
