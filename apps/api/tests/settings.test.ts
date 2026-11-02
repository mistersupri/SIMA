import { beforeAll, describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import { call, seedBase, sessionFor, type Session } from './app-helpers';
import { db, resetDb } from './helpers';

let root: Session, adminInv: Session, viewer: Session;

beforeAll(async () => {
  await resetDb();
  await seedBase();
  root = (await sessionFor('SUPER_ADMIN')).session;
  adminInv = (await sessionFor('ADMIN_INVENTARIS')).session;
  viewer = (await sessionFor('VIEWER')).session;
});

describe('pengaturan identitas instansi', () => {
  it('app-info publik hanya memuat nama instansi', async () => {
    const r = await call('GET', '/app-info');
    expect(r.status).toBe(200);
    expect(Object.keys(r.body.data)).toEqual(['organizationName']);
  });

  it('hanya Super Admin (settings.manage) yang dapat membaca dan mengubah', async () => {
    for (const s of [adminInv, viewer]) {
      expect((await call('GET', '/settings/organization', { session: s })).status).toBe(403);
      expect((await call('PATCH', '/settings/organization', { session: s, body: { name: 'Peretas' } })).status).toBe(403);
    }
    expect((await call('PATCH', '/settings/organization', { body: { name: 'X' } })).status).toBe(401);
    expect((await call('GET', '/settings/organization', { session: root })).status).toBe(200);
  });

  it('validasi: nama wajib, email harus valid, kode instansi tidak dapat diubah', async () => {
    const empty = await call('PATCH', '/settings/organization', { session: root, body: { name: '  ' } });
    expect(empty.status).toBe(400);
    const email = await call('PATCH', '/settings/organization', { session: root, body: { name: 'Dinas A', email: 'bukan-email' } });
    expect(email.status).toBe(400);
    const before = await db.organization.findFirstOrThrow();
    await call('PATCH', '/settings/organization', { session: root, body: { name: 'Dinas A', code: 'HACK' } });
    expect((await db.organization.findFirstOrThrow()).code).toBe(before.code);
  });

  it('perubahan tersimpan, tampil di app-info, tercatat di audit log, dan memasuki kepala export', async () => {
    const r = await call('PATCH', '/settings/organization', { session: root, body: { name: 'Dinas Pekerjaan Umum', address: 'Jl. Merdeka 1', phone: '', email: 'UMUM@dinas.go.id' } });
    expect(r.status).toBe(200);
    expect(r.body.data).toMatchObject({ name: 'Dinas Pekerjaan Umum', address: 'Jl. Merdeka 1', phone: null, email: 'umum@dinas.go.id' });
    expect((await call('GET', '/app-info')).body.data.organizationName).toBe('Dinas Pekerjaan Umum');

    const log = await db.auditLog.findFirst({ where: { entityType: 'Organization', action: 'UPDATE' }, orderBy: { createdAt: 'desc' } });
    expect(log).not.toBeNull();
    expect((log!.after as { name: string }).name).toBe('Dinas Pekerjaan Umum');

    const ex = await call('GET', '/exports/assets?format=xlsx', { session: root });
    expect(ex.status).toBe(200);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(ex.res.rawPayload as unknown as ExcelJS.Buffer);
    expect(String(wb.worksheets[0]!.getCell(2, 1).value)).toContain('Dinas Pekerjaan Umum');
  });
});
