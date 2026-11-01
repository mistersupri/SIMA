import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { call, login, makeUser, seedBase, sessionFor, TEST_PASSWORD } from './app-helpers';
import { db, resetDb } from './helpers';

beforeAll(async () => { await resetDb(); await seedBase(); });
afterAll(() => db.$disconnect());

describe('login dan session', () => {
  it('login sukses: cookie HttpOnly + SameSite=Lax, payload tanpa hash password', async () => {
    const { email, password } = await makeUser('VIEWER');
    const r = await call('POST', '/auth/login', { body: { email: email.toUpperCase(), password } });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ success: true, meta: null });
    expect(r.body.data.user.email).toBe(email);
    expect(r.body.data.user.roles[0].code).toBe('VIEWER');
    expect(JSON.stringify(r.body)).not.toMatch(/passwordHash|argon2/);
    const c = r.res.cookies.find((x) => x.name === 'sima_sid')!;
    expect(c.httpOnly).toBe(true);
    expect(c.sameSite).toBe('Lax');
    expect(c.path).toBe('/');
    expect(c.value.length).toBeGreaterThan(30);
  });

  it('token session tidak disimpan mentah di database (hanya hash SHA-256)', async () => {
    const s = await sessionFor('VIEWER');
    const raw = s.session.cookie.split('=')[1]!;
    const rows = await db.session.findMany({ where: { userId: s.user.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(rows[0]!.tokenHash).not.toBe(raw);
  });

  it('password salah dan email tak dikenal menghasilkan respons identik', async () => {
    const { email } = await makeUser('VIEWER');
    const bad = await call('POST', '/auth/login', { body: { email, password: 'salah-sekali-123A' } });
    const unknown = await call('POST', '/auth/login', { body: { email: 'tidak-ada@uji.test', password: 'salah-sekali-123A' } });
    expect(bad.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(bad.body).toEqual(unknown.body);
  });

  it('validasi input login memberi error per field', async () => {
    const r = await call('POST', '/auth/login', { body: { email: 'bukan-email', password: '' } });
    expect(r.status).toBe(400);
    expect(r.body.success).toBe(false);
    expect(r.body.errors.map((e: any) => e.field).sort()).toEqual(['email', 'password']);
  });

  it('akun terkunci setelah 5 kegagalan, bahkan dengan password benar', async () => {
    const { email, password } = await makeUser('VIEWER');
    for (let i = 0; i < 5; i++) {
      expect((await call('POST', '/auth/login', { body: { email, password: 'Salah-Terus-123' } })).status).toBe(401);
    }
    const locked = await call('POST', '/auth/login', { body: { email, password } });
    expect(locked.status).toBe(429);
    expect(locked.body.message).toMatch(/terkunci/i);
  });

  it('akun nonaktif tidak bisa login', async () => {
    const { email, password } = await makeUser('VIEWER', { status: 'INACTIVE' });
    const r = await call('POST', '/auth/login', { body: { email, password } });
    expect(r.status).toBe(403);
  });

  it('endpoint terproteksi menolak permintaan tanpa login', async () => {
    for (const [m, u] of [['GET', '/auth/me'], ['GET', '/users'], ['GET', '/categories'], ['GET', '/roles']] as const) {
      expect((await call(m, u)).status).toBe(401);
    }
    expect((await call('GET', '/health')).status).toBe(200);
  });

  it('logout mencabut session di server', async () => {
    const s = await sessionFor('VIEWER');
    expect((await call('GET', '/auth/me', { session: s.session })).status).toBe(200);
    expect((await call('POST', '/auth/logout', { session: s.session })).status).toBe(200);
    expect((await call('GET', '/auth/me', { session: s.session })).status).toBe(401);
  });

  it('login ulang merotasi session: cookie lama tidak berlaku lagi', async () => {
    const { email, password } = await makeUser('VIEWER');
    const first = await login(email, password);
    const r = await call('POST', '/auth/login', { body: { email, password }, headers: { cookie: first.cookie } });
    expect(r.status).toBe(200);
    expect((await call('GET', '/auth/me', { session: first })).status).toBe(401);
  });

  it('session kedaluwarsa ditolak', async () => {
    const s = await sessionFor('VIEWER');
    await db.session.updateMany({ where: { userId: s.user.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expect((await call('GET', '/auth/me', { session: s.session })).status).toBe(401);
  });

  it('menonaktifkan pengguna mencabut session aktifnya', async () => {
    const admin = await sessionFor('SUPER_ADMIN');
    const target = await sessionFor('VIEWER');
    const r = await call('PATCH', `/users/${target.user.id}/status`, { session: admin.session, body: { status: 'INACTIVE' } });
    expect(r.status).toBe(200);
    expect((await call('GET', '/auth/me', { session: target.session })).status).toBe(401);
  });
});

describe('CSRF', () => {
  it('request yang mengubah data tanpa token CSRF ditolak, dengan token diterima', async () => {
    const s = await sessionFor('SUPER_ADMIN');
    const body = { code: 'CSRF1', name: 'Satuan CSRF' };
    const denied = await call('POST', '/units', { session: s.session, body, skipCsrf: true });
    expect(denied.status).toBe(403);
    expect(denied.body.message).toMatch(/CSRF/);
    expect((await call('POST', '/units', { session: s.session, body: { ...body, code: 'CSRF2' }, headers: { 'x-csrf-token': 'salah' } })).status).toBe(403);
    expect((await call('POST', '/units', { session: s.session, body })).status).toBe(201);
  });
});

describe('wajib ganti password', () => {
  it('memblokir endpoint lain sampai password diganti, lalu mencabut session lain', async () => {
    const u = await sessionFor('SUPER_ADMIN', { mustChangePassword: true });
    const other = await login(u.email, u.password);
    const blocked = await call('GET', '/users', { session: u.session });
    expect(blocked.status).toBe(403);
    expect(blocked.body.message).toMatch(/mengganti password/i);
    expect((await call('GET', '/auth/me', { session: u.session })).body.data.user.mustChangePassword).toBe(true);

    const weak = await call('POST', '/auth/change-password', { session: u.session, body: { currentPassword: u.password, newPassword: 'pendek', confirmPassword: 'pendek' } });
    expect(weak.status).toBe(400);
    const wrong = await call('POST', '/auth/change-password', { session: u.session, body: { currentPassword: 'SalahSekali123', newPassword: 'Password-Baru-123', confirmPassword: 'Password-Baru-123' } });
    expect(wrong.status).toBe(400);
    expect(wrong.body.errors[0].field).toBe('currentPassword');

    const ok = await call('POST', '/auth/change-password', { session: u.session, body: { currentPassword: u.password, newPassword: 'Password-Baru-123', confirmPassword: 'Password-Baru-123' } });
    expect(ok.status).toBe(200);
    expect((await call('GET', '/users', { session: u.session })).status).toBe(200);
    expect((await call('GET', '/auth/me', { session: other })).status).toBe(401);
    expect((await call('POST', '/auth/login', { body: { email: u.email, password: u.password } })).status).toBe(401);
    expect((await call('POST', '/auth/login', { body: { email: u.email, password: 'Password-Baru-123' } })).status).toBe(200);
  });
});

describe('reset password', () => {
  it('forgot-password tidak membocorkan email terdaftar; token sekali pakai', async () => {
    const { email, user } = await makeUser('VIEWER');
    const known = await call('POST', '/auth/forgot-password', { body: { email } });
    const unknown = await call('POST', '/auth/forgot-password', { body: { email: 'x@uji.test' } });
    expect(known.status).toBe(200);
    expect(known.body).toEqual(unknown.body);
    expect(await db.passwordResetToken.count({ where: { userId: user.id } })).toBe(1);

    // Token mentah tidak tersimpan; buat token uji dengan hash yang cocok.
    const { createHash } = await import('node:crypto');
    const raw = 'token-uji-reset-1234567890';
    await db.passwordResetToken.create({ data: { userId: user.id, tokenHash: createHash('sha256').update(raw).digest('hex'), expiresAt: new Date(Date.now() + 60000) } });
    const done = await call('POST', '/auth/reset-password', { body: { token: raw, newPassword: 'Reset-Baru-12345' } });
    expect(done.status).toBe(200);
    expect((await call('POST', '/auth/reset-password', { body: { token: raw, newPassword: 'Reset-Lagi-12345' } })).status).toBe(400);
    expect((await call('POST', '/auth/login', { body: { email, password: 'Reset-Baru-12345' } })).status).toBe(200);
  });
});

describe('audit login', () => {
  it('login dan logout tercatat di audit log dan activity log', async () => {
    const s = await sessionFor('VIEWER');
    await call('POST', '/auth/logout', { session: s.session });
    const audits = await db.auditLog.findMany({ where: { userId: s.user.id }, orderBy: { createdAt: 'asc' } });
    expect(audits.map((a) => a.action)).toEqual(['LOGIN', 'LOGOUT']);
    expect(await db.activityLog.count({ where: { userId: s.user.id, action: 'auth.login' } })).toBe(1);
    expect(TEST_PASSWORD).toBeTruthy();
  });
});
