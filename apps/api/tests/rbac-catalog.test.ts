import { describe, expect, it } from 'vitest';
import { ALL_PERMISSION_CODES, PERMISSIONS, ROLE_CODES, ROLE_DEFINITIONS } from '@sima/shared';

const role = (code: string) => ROLE_DEFINITIONS.find((r) => r.code === code)!;

describe('katalog permission dan role', () => {
  it('kode permission unik dan berformat modul.aksi', () => {
    const codes = PERMISSIONS.map((p) => p.code);
    expect(new Set(codes).size).toBe(codes.length);
    for (const c of codes) expect(c).toMatch(/^[a-z_]+\.[a-z_]+$/);
  });

  it('seluruh permission yang disebut spesifikasi tersedia', () => {
    for (const c of [
      'dashboard.view', 'items.view', 'items.create', 'items.update', 'items.archive',
      'assets.view', 'assets.create', 'assets.update', 'assets.export',
      'mutations.create', 'mutations.submit', 'mutations.approve', 'mutations.reject',
      'loans.create', 'loans.approve', 'loans.return',
      'stock_opnames.create', 'stock_opnames.verify',
      'reports.view', 'reports.export', 'users.manage', 'settings.manage',
    ]) {
      expect(ALL_PERMISSION_CODES).toContain(c);
    }
  });

  it('lima role standar terdefinisi dan hanya memakai permission yang valid', () => {
    expect(ROLE_DEFINITIONS.map((r) => r.code).sort()).toEqual(Object.values(ROLE_CODES).sort());
    for (const r of ROLE_DEFINITIONS) {
      for (const p of r.permissions) expect(ALL_PERMISSION_CODES).toContain(p);
    }
  });

  it('Super Admin memiliki semua permission', () => {
    expect(role('SUPER_ADMIN').permissions).toHaveLength(ALL_PERMISSION_CODES.length);
  });

  it('pemisahan tugas: hanya Approver (dan Super Admin) yang bisa menyetujui', () => {
    const approvers = ROLE_DEFINITIONS.filter((r) => r.permissions.some((p) => p.endsWith('.approve'))).map((r) => r.code);
    expect(approvers.sort()).toEqual(['APPROVER', 'SUPER_ADMIN']);
  });

  it('Viewer tidak memiliki izin mengubah data', () => {
    const mutating = role('VIEWER').permissions.filter((p) => !p.endsWith('.view') && !p.endsWith('.export'));
    expect(mutating).toEqual([]);
  });

  it('Petugas tidak mengelola master data, pengguna, atau role', () => {
    const p = role('PETUGAS_INVENTARIS').permissions;
    expect(p).not.toContain('master.manage');
    expect(p).not.toContain('users.manage');
    expect(p).not.toContain('roles.manage');
  });
});
