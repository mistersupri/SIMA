import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MASTER_RESOURCES } from '@sima/shared';
import { call, seedBase, sessionFor, type Session } from './app-helpers';
import { db, resetDb } from './helpers';

let admin: Session;
let viewer: Session;
beforeAll(async () => {
  await resetDb();
  await seedBase();
  admin = (await sessionFor('ADMIN_INVENTARIS')).session;
  viewer = (await sessionFor('VIEWER')).session;
});
afterAll(() => db.$disconnect());

describe('master data CRUD', () => {
  it('semua resource master terdaftar dan dapat dilist (pagination + format konsisten)', async () => {
    for (const r of MASTER_RESOURCES) {
      const res = await call('GET', `/${r}?page=1&limit=5`, { session: viewer });
      expect(res.status, r).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.meta).toMatchObject({ page: 1, limit: 5 });
      expect(Array.isArray(res.body.data)).toBe(true);
    }
  });

  it('kategori: normalisasi kode, validasi awalan 3 huruf, kode ganda ditolak', async () => {
    const bad = await call('POST', '/categories', { session: admin, body: { code: 'alat berat', codePrefix: 'AB', name: 'Alat Berat' } });
    expect(bad.status).toBe(400);
    expect(bad.body.errors.map((e: any) => e.field)).toContain('codePrefix');
    const ok = await call('POST', '/categories', { session: admin, body: { code: 'alat berat', codePrefix: 'abr', name: 'Alat Berat' } });
    expect(ok.status).toBe(201);
    expect(ok.body.data).toMatchObject({ code: 'ALAT-BERAT', codePrefix: 'ABR', isActive: true });
    const dup = await call('POST', '/categories', { session: admin, body: { code: 'ALAT-BERAT', codePrefix: 'XYZ', name: 'Lain' } });
    expect(dup.status).toBe(409);
    expect(dup.body.errors[0].field).toBe('code');
  });

  it('update parsial, audit before/after, dan ID tidak valid/tidak ada', async () => {
    const created = await call('POST', '/vendors', { session: admin, body: { code: 'v-1', name: 'PT Maju', email: 'KONTAK@MAJU.test' } });
    expect(created.body.data.email).toBe('kontak@maju.test');
    const id = created.body.data.id;
    const upd = await call('PATCH', `/vendors/${id}`, { session: admin, body: { phone: '0211234' } });
    expect(upd.status).toBe(200);
    expect(upd.body.data).toMatchObject({ phone: '0211234', name: 'PT Maju' });
    const audit = await db.auditLog.findFirstOrThrow({ where: { entityType: 'Vendor', entityId: id, action: 'UPDATE' } });
    expect((audit.before as any).phone).toBeNull();
    expect((audit.after as any).phone).toBe('0211234');
    expect((await call('GET', '/vendors/bukan-uuid', { session: admin })).status).toBe(400);
    expect((await call('GET', '/vendors/00000000-0000-4000-8000-000000000000', { session: admin })).status).toBe(404);
    expect((await call('PATCH', `/vendors/${id}`, { session: admin, body: { email: 'rusak' } })).status).toBe(400);
  });

  it('DELETE menonaktifkan (soft), data tetap ada dan bisa difilter/diaktifkan lagi', async () => {
    const c = await call('POST', '/brands', { session: admin, body: { name: 'Merek Lama' } });
    const id = c.body.data.id;
    expect((await call('DELETE', `/brands/${id}`, { session: admin })).body.data.isActive).toBe(false);
    expect(await db.brand.count({ where: { id } })).toBe(1);
    const inactive = await call('GET', '/brands?isActive=false', { session: admin });
    expect(inactive.body.data.map((b: any) => b.id)).toContain(id);
    const active = await call('GET', '/brands?isActive=true', { session: admin });
    expect(active.body.data.map((b: any) => b.id)).not.toContain(id);
    expect((await call('PATCH', `/brands/${id}`, { session: admin, body: { isActive: true } })).body.data.isActive).toBe(true);
    expect(await db.auditLog.count({ where: { entityType: 'Brand', entityId: id, action: 'ARCHIVE' } })).toBe(1);
  });

  it('hierarki lokasi: induk valid, tidak boleh siklus', async () => {
    const mk = (code: string, type: string, parentId?: string) =>
      call('POST', '/locations', { session: admin, body: { code, name: code, type, parentId: parentId ?? null } });
    const gedung = (await mk('GDG-A', 'BUILDING')).body.data;
    const lantai = (await mk('GDG-A-L1', 'FLOOR', gedung.id)).body.data;
    const ruang = (await mk('GDG-A-L1-R1', 'ROOM', lantai.id)).body.data;
    expect(ruang.parent.name).toBe('GDG-A-L1');
    const self = await call('PATCH', `/locations/${gedung.id}`, { session: admin, body: { parentId: gedung.id } });
    expect(self.status).toBe(422);
    const cycle = await call('PATCH', `/locations/${gedung.id}`, { session: admin, body: { parentId: ruang.id } });
    expect(cycle.status).toBe(422);
    expect((await call('POST', '/locations', { session: admin, body: { code: 'X', name: 'X', type: 'ROOM', parentId: '00000000-0000-4000-8000-000000000000' } })).status).toBe(409);
  });

  it('pencarian dan sorting berjalan di server', async () => {
    for (const n of ['Zebra', 'Apel', 'Mangga']) await call('POST', '/brands', { session: admin, body: { name: `Buah ${n}` } });
    const asc = await call('GET', '/brands?search=buah&sortBy=name&sortOrder=asc', { session: admin });
    expect(asc.body.data.map((b: any) => b.name)).toEqual(['Buah Apel', 'Buah Mangga', 'Buah Zebra']);
    const desc = await call('GET', '/brands?search=BUAH&sortBy=name&sortOrder=desc', { session: admin });
    expect(desc.body.data.map((b: any) => b.name)).toEqual(['Buah Zebra', 'Buah Mangga', 'Buah Apel']);
    const p2 = await call('GET', '/brands?search=buah&sortBy=name&sortOrder=asc&limit=2&page=2', { session: admin });
    expect(p2.body.data.map((b: any) => b.name)).toEqual(['Buah Zebra']);
    expect(p2.body.meta).toMatchObject({ total: 3, totalPages: 2, page: 2 });
  });

  it('injeksi SQL di parameter pencarian diperlakukan sebagai teks biasa', async () => {
    const r = await call('GET', `/brands?search=${encodeURIComponent("'; DROP TABLE brands; --")}`, { session: admin });
    expect(r.status).toBe(200);
    expect(r.body.data).toEqual([]);
    expect(await db.brand.count()).toBeGreaterThan(0);
  });
});
