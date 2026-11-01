import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { call, makeUser, seedBase, sessionFor } from './app-helpers';
import { db, resetDb } from './helpers';

beforeAll(async () => { await resetDb(); await seedBase(); });
afterAll(() => db.$disconnect());

describe('RBAC di backend', () => {
  it('Viewer: boleh membaca, tidak boleh mengubah (tombol disembunyikan tidak cukup)', async () => {
    const v = await sessionFor('VIEWER');
    expect((await call('GET', '/categories', { session: v.session })).status).toBe(200);
    expect((await call('GET', '/users', { session: v.session })).status).toBe(200);
    expect((await call('POST', '/categories', { session: v.session, body: { code: 'X', codePrefix: 'XXX', name: 'X' } })).status).toBe(403);
    expect((await call('POST', '/users', { session: v.session, body: {} })).status).toBe(403);
    expect((await call('PUT', '/roles/00000000-0000-4000-8000-000000000000/permissions', { session: v.session, body: { permissions: [] } })).status).toBe(403);
  });

  it('Petugas: bisa melihat master data tapi tidak mengelolanya, tidak melihat pengguna/role', async () => {
    const p = await sessionFor('PETUGAS_INVENTARIS');
    expect((await call('GET', '/locations', { session: p.session })).status).toBe(200);
    expect((await call('POST', '/locations', { session: p.session, body: { code: 'R1', name: 'R', type: 'ROOM' } })).status).toBe(403);
    expect((await call('GET', '/users', { session: p.session })).status).toBe(403);
    expect((await call('GET', '/roles', { session: p.session })).status).toBe(403);
  });

  it('Admin Inventaris: mengelola master data tapi bukan pengguna atau role', async () => {
    const a = await sessionFor('ADMIN_INVENTARIS');
    expect((await call('POST', '/brands', { session: a.session, body: { name: 'Lenovo' } })).status).toBe(201);
    expect((await call('POST', '/users', { session: a.session, body: {} })).status).toBe(403);
    expect((await call('POST', '/roles', { session: a.session, body: { code: 'X', name: 'X' } })).status).toBe(403);
  });

  it('role dari header/body klien diabaikan; hak akses hanya dari database', async () => {
    const v = await sessionFor('VIEWER');
    const r = await call('POST', '/brands', { session: v.session, body: { name: 'Palsu', roles: ['SUPER_ADMIN'] }, headers: { 'x-roles': 'SUPER_ADMIN' } });
    expect(r.status).toBe(403);
  });

  it('pengguna dengan banyak role mendapat gabungan permission', async () => {
    const admin = await sessionFor('SUPER_ADMIN');
    const multi = await sessionFor('VIEWER');
    expect((await call('POST', '/brands', { session: multi.session, body: { name: 'Multi' } })).status).toBe(403);
    const petugas = await db.role.findUniqueOrThrow({ where: { code: 'ADMIN_INVENTARIS' } });
    const viewer = await db.role.findUniqueOrThrow({ where: { code: 'VIEWER' } });
    const r = await call('PUT', `/users/${multi.user.id}/roles`, { session: admin.session, body: { roleIds: [viewer.id, petugas.id] } });
    expect(r.status).toBe(200);
    expect(r.body.data.roles).toHaveLength(2);
    // Perubahan berlaku pada permintaan berikutnya tanpa login ulang.
    expect((await call('POST', '/brands', { session: multi.session, body: { name: 'Multi' } })).status).toBe(201);
  });
});

describe('manajemen pengguna', () => {
  it('membuat pengguna: wajib ganti password, email unik, audit tercatat tanpa hash', async () => {
    const admin = await sessionFor('SUPER_ADMIN');
    const role = await db.role.findUniqueOrThrow({ where: { code: 'PETUGAS_INVENTARIS' } });
    const body = { name: 'Budi Petugas', email: 'Budi@Instansi.test', password: 'Sandi-Awal-12345', roleIds: [role.id] };
    const created = await call('POST', '/users', { session: admin.session, body });
    expect(created.status).toBe(201);
    expect(created.body.data.email).toBe('budi@instansi.test');
    expect(JSON.stringify(created.body)).not.toMatch(/passwordHash|argon2/);
    const row = await db.user.findUniqueOrThrow({ where: { email: 'budi@instansi.test' } });
    expect(row.mustChangePassword).toBe(true);
    expect(row.passwordHash.startsWith('$argon2id$')).toBe(true);

    const dup = await call('POST', '/users', { session: admin.session, body });
    expect(dup.status).toBe(409);
    expect(dup.body.errors[0].field).toBe('email');

    const audit = await db.auditLog.findFirstOrThrow({ where: { entityType: 'User', entityId: row.id, action: 'CREATE' } });
    expect(audit.userId).toBe(admin.user.id);
    expect(JSON.stringify(audit.after)).not.toMatch(/passwordHash|argon2/);
  });

  it('validasi: password lemah dan role kosong ditolak per field', async () => {
    const admin = await sessionFor('SUPER_ADMIN');
    const r = await call('POST', '/users', { session: admin.session, body: { name: '', email: 'x', password: 'lemah', roleIds: [] } });
    expect(r.status).toBe(400);
    expect([...new Set(r.body.errors.map((e: any) => e.field))].sort()).toEqual(['email', 'name', 'password', 'roleIds']);
  });

  it('daftar pengguna: pagination, pencarian, filter, dan format konsisten', async () => {
    const admin = await sessionFor('SUPER_ADMIN');
    for (let i = 0; i < 4; i++) await makeUser('VIEWER');
    const page = await call('GET', '/users?page=1&limit=2&sortBy=email&sortOrder=asc', { session: admin.session });
    expect(page.status).toBe(200);
    expect(page.body.data).toHaveLength(2);
    expect(page.body.meta).toMatchObject({ page: 1, limit: 2 });
    expect(page.body.meta.total).toBeGreaterThanOrEqual(5);
    const emails = page.body.data.map((u: any) => u.email);
    expect([...emails].sort()).toEqual(emails);
    const search = await call('GET', `/users?search=${encodeURIComponent(admin.email.slice(0, 12))}`, { session: admin.session });
    expect(search.body.data.some((u: any) => u.id === admin.user.id)).toBe(true);
    expect((await call('GET', '/users?limit=500', { session: admin.session })).status).toBe(400);
    // kolom sort di luar whitelist diabaikan, bukan diteruskan ke query
    expect((await call('GET', '/users?sortBy=passwordHash', { session: admin.session })).status).toBe(200);
  });

  it('tidak bisa menonaktifkan diri sendiri atau Super Admin terakhir', async () => {
    await resetDb(); await seedBase();
    const only = await sessionFor('SUPER_ADMIN');
    const self = await call('PATCH', `/users/${only.user.id}/status`, { session: only.session, body: { status: 'INACTIVE' } });
    expect(self.status).toBe(422);
    const other = await sessionFor('SUPER_ADMIN');
    const bootstrap = await db.user.findFirstOrThrow({ where: { email: 'admin@sima.local' } });
    // Ada 3 Super Admin aktif: menonaktifkan bootstrap boleh; sisakan dua lalu coba menghabiskan.
    expect((await call('PATCH', `/users/${bootstrap.id}/status`, { session: only.session, body: { status: 'INACTIVE' } })).status).toBe(200);
    expect((await call('PATCH', `/users/${only.user.id}/status`, { session: other.session, body: { status: 'INACTIVE' } })).status).toBe(200);
    const last = await call('PATCH', `/users/${other.user.id}/status`, { session: other.session, body: { status: 'INACTIVE' } });
    expect(last.status).toBe(422);
    // Mencabut role Super Admin terakhir juga ditolak.
    const viewer = await db.role.findUniqueOrThrow({ where: { code: 'VIEWER' } });
    const strip = await call('PUT', `/users/${other.user.id}/roles`, { session: other.session, body: { roleIds: [viewer.id] } });
    expect(strip.status).toBe(422);
  });

  it('hanya Super Admin yang boleh memberi role Super Admin', async () => {
    const admin = await sessionFor('ADMIN_INVENTARIS');
    // Admin Inventaris tidak punya users.manage, jadi ditolak lebih awal.
    const sa = await db.role.findUniqueOrThrow({ where: { code: 'SUPER_ADMIN' } });
    const target = await makeUser('VIEWER');
    expect((await call('PUT', `/users/${target.user.id}/roles`, { session: admin.session, body: { roleIds: [sa.id] } })).status).toBe(403);
    // Role kustom dengan users.manage tetap tidak boleh menyentuh Super Admin.
    const sup = await sessionFor('SUPER_ADMIN');
    const created = await call('POST', '/roles', { session: sup.session, body: { code: 'pengelola pengguna', name: 'Pengelola Pengguna' } });
    expect(created.status).toBe(201);
    expect(created.body.data.code).toBe('PENGELOLA_PENGGUNA');
    const setPerm = await call('PUT', `/roles/${created.body.data.id}/permissions`, { session: sup.session, body: { permissions: ['users.view', 'users.manage'] } });
    expect(setPerm.status).toBe(200);
    const mgr = await makeUser('VIEWER');
    await call('PUT', `/users/${mgr.user.id}/roles`, { session: sup.session, body: { roleIds: [created.body.data.id] } });
    const { login } = await import('./app-helpers');
    const mgrSession = await login(mgr.email, mgr.password);
    const attempt = await call('PUT', `/users/${target.user.id}/roles`, { session: mgrSession, body: { roleIds: [sa.id] } });
    expect(attempt.status).toBe(403);
    expect(attempt.body.message).toMatch(/Super Admin/);
  });

  it('reset password oleh admin memaksa ganti password dan mencabut session', async () => {
    const admin = await sessionFor('SUPER_ADMIN');
    const t = await sessionFor('VIEWER');
    const r = await call('POST', `/users/${t.user.id}/reset-password`, { session: admin.session, body: { newPassword: 'Sementara-12345' } });
    expect(r.status).toBe(200);
    expect((await call('GET', '/auth/me', { session: t.session })).status).toBe(401);
    expect((await db.user.findUniqueOrThrow({ where: { id: t.user.id } })).mustChangePassword).toBe(true);
  });
});

describe('role dan permission', () => {
  it('permission Super Admin tidak bisa diubah; permission tak dikenal ditolak; role sistem tak bisa dihapus', async () => {
    const sup = await sessionFor('SUPER_ADMIN');
    const sa = await db.role.findUniqueOrThrow({ where: { code: 'SUPER_ADMIN' } });
    const viewer = await db.role.findUniqueOrThrow({ where: { code: 'VIEWER' } });
    expect((await call('PUT', `/roles/${sa.id}/permissions`, { session: sup.session, body: { permissions: [] } })).status).toBe(403);
    const unknown = await call('PUT', `/roles/${viewer.id}/permissions`, { session: sup.session, body: { permissions: ['items.hack'] } });
    expect(unknown.status).toBe(422);
    expect((await call('DELETE', `/roles/${viewer.id}`, { session: sup.session })).status).toBe(403);
    const list = await call('GET', '/roles', { session: sup.session });
    expect(list.body.data).toHaveLength(await db.role.count());
    expect((await call('GET', '/permissions', { session: sup.session })).body.data.length).toBeGreaterThan(60);
  });

  it('perubahan permission role langsung memengaruhi akses dan tercatat di audit', async () => {
    const sup = await sessionFor('SUPER_ADMIN');
    const v = await sessionFor('VIEWER');
    const role = await db.role.findUniqueOrThrow({ where: { code: 'VIEWER' } });
    const before = (await call('GET', '/roles', { session: sup.session })).body.data.find((r: any) => r.code === 'VIEWER').permissions as string[];
    expect((await call('GET', '/users', { session: v.session })).status).toBe(200);
    const without = before.filter((p) => p !== 'users.view');
    expect((await call('PUT', `/roles/${role.id}/permissions`, { session: sup.session, body: { permissions: without } })).status).toBe(200);
    expect((await call('GET', '/users', { session: v.session })).status).toBe(403);
    await call('PUT', `/roles/${role.id}/permissions`, { session: sup.session, body: { permissions: before } });
    const audits = await db.auditLog.findMany({ where: { action: 'PERMISSION_CHANGE', entityId: role.id } });
    expect(audits.length).toBeGreaterThanOrEqual(2);
  });
});
