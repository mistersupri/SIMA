import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { buildApp } from '../src/app';
import { loadEnv } from '../src/config/env';
import { CSP } from '../src/plugins/web';

let app: Awaited<ReturnType<typeof buildApp>>;
let dir: string;

beforeAll(async () => {
  dir = mkdtempSync(path.join(tmpdir(), 'sima-web-'));
  mkdirSync(path.join(dir, 'assets'));
  writeFileSync(path.join(dir, 'index.html'), '<!doctype html><title>SIMA</title><div id="root"></div>');
  writeFileSync(path.join(dir, 'sw.js'), '// sw');
  writeFileSync(path.join(dir, 'assets', 'app-abc123.js'), 'console.log(1)');
  app = await buildApp(loadEnv({ ...process.env, WEB_DIST: dir }));
  await app.ready();
});
afterAll(async () => { await app.close(); rmSync(dir, { recursive: true, force: true }); });

describe('penyajian aplikasi web dari API', () => {
  it('rute klien SPA mengembalikan index.html (bukan 404) dengan CSP dan tanpa cache', async () => {
    for (const url of ['/', '/aset/123', '/pengaturan/audit-log?x=1']) {
      const r = await app.inject({ method: 'GET', url });
      expect(r.statusCode, url).toBe(200);
      expect(r.body).toContain('<div id="root">');
      expect(r.headers['content-type']).toMatch(/text\/html/);
      expect(r.headers['content-security-policy']).toBe(CSP);
      expect(r.headers['x-frame-options']).toBe('DENY');
      expect(r.headers['cache-control']).toBe('no-cache');
    }
  });

  it('aset ber-hash di-cache lama, sw.js tidak di-cache, berkas yang tidak ada → 404 (bukan index)', async () => {
    const a = await app.inject({ method: 'GET', url: '/assets/app-abc123.js' });
    expect(a.statusCode).toBe(200);
    expect(a.headers['cache-control']).toBe('public, max-age=31536000, immutable');
    expect(a.headers['content-security-policy']).toBe(CSP);
    expect((await app.inject({ method: 'GET', url: '/sw.js' })).headers['cache-control']).toBe('no-cache');
    expect((await app.inject({ method: 'GET', url: '/assets/tidak-ada.js' })).statusCode).toBe(404);
  });

  it('API tetap menjawab JSON: endpoint tidak dikenal 404 JSON, bukan HTML', async () => {
    const r = await app.inject({ method: 'GET', url: '/api/v1/tidak-ada' });
    expect(r.statusCode).toBe(404);
    expect(r.json()).toMatchObject({ success: false });
    expect(r.headers['content-security-policy']).toBeUndefined();
    expect((await app.inject({ method: 'GET', url: '/api/v1/health' })).json().success).toBe(true);
    expect((await app.inject({ method: 'POST', url: '/aset/123' })).statusCode).toBe(404);
  });

  it('tidak dapat membaca berkas di luar folder web (path traversal)', async () => {
    for (const url of ['/..%2f..%2f..%2fetc%2fpasswd', '/%2e%2e/%2e%2e/etc/passwd', '/assets/..%2f..%2fpackage.json']) {
      const r = await app.inject({ method: 'GET', url });
      expect(r.body, url).not.toMatch(/root:|"name"/);
    }
  });

  it('file statis tidak terkena batas laju API', async () => {
    for (let i = 0; i < 700; i++) {
      const r = await app.inject({ method: 'GET', url: '/assets/app-abc123.js' });
      if (r.statusCode !== 200) throw new Error(`permintaan ke-${i} → ${r.statusCode}`);
    }
  });

  it('WEB_DIST tanpa index.html ditolak saat start', async () => {
    const empty = mkdtempSync(path.join(tmpdir(), 'sima-web-empty-'));
    await expect(buildApp(loadEnv({ ...process.env, WEB_DIST: empty }))).rejects.toThrow(/index\.html/);
    rmSync(empty, { recursive: true, force: true });
  });
});
