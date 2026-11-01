import { beforeEach, describe, expect, it, afterAll } from 'vitest';
import { execSync } from 'node:child_process';
import { PERMISSIONS } from '@sima/shared';
import { createFixture, db, resetDb } from './helpers';

beforeEach(resetDb);
afterAll(() => db.$disconnect());

describe('constraint database', () => {
  it('menolak saldo stok negatif', async () => {
    const f = await createFixture();
    await expect(
      db.stockBalance.create({ data: { itemId: f.supply.id, warehouseId: f.warehouse.id, quantity: -1 } }),
    ).rejects.toThrow(/stock_balances_quantity_non_negative/);
  });

  it('menolak baris ledger yang masuk dan keluar sekaligus', async () => {
    const f = await createFixture();
    const tx = await db.stockTransaction.create({
      data: { number: 'TX-1', type: 'IN', date: new Date(), warehouseId: f.warehouse.id, createdById: f.user.id },
    });
    await expect(
      db.stockTransactionDetail.create({
        data: { transactionId: tx.id, itemId: f.supply.id, warehouseId: f.warehouse.id, quantityIn: 5, quantityOut: 2, balanceAfter: 3 },
      }),
    ).rejects.toThrow(/stock_tx_details_amounts_valid/);
  });

  it('ledger yang sudah diposting tidak bisa diubah atau dihapus', async () => {
    const f = await createFixture();
    const tx = await db.stockTransaction.create({
      data: { number: 'TX-2', type: 'OPENING', date: new Date(), warehouseId: f.warehouse.id, createdById: f.user.id },
    });
    const line = await db.stockTransactionDetail.create({
      data: { transactionId: tx.id, itemId: f.supply.id, warehouseId: f.warehouse.id, quantityIn: 100, balanceAfter: 100 },
    });
    await expect(
      db.stockTransactionDetail.update({ where: { id: line.id }, data: { quantityIn: 999 } }),
    ).rejects.toThrow(/append-only/);
    await expect(db.stockTransactionDetail.delete({ where: { id: line.id } })).rejects.toThrow(/append-only/);
    await expect(db.stockTransaction.delete({ where: { id: tx.id } })).rejects.toThrow(/append-only/);
  });

  it('audit log bersifat append-only', async () => {
    const log = await db.auditLog.create({ data: { action: 'CREATE', entityType: 'Asset', entityId: 'x' } });
    await expect(db.auditLog.update({ where: { id: log.id }, data: { action: 'DELETE' } })).rejects.toThrow(/append-only/);
    await expect(db.auditLog.delete({ where: { id: log.id } })).rejects.toThrow(/append-only/);
  });

  it('histori lokasi aset append-only', async () => {
    const f = await createFixture();
    const h = await db.assetLocationHistory.create({
      data: { assetId: f.asset.id, toLocationId: f.location.id, sourceType: 'REGISTRATION' },
    });
    await expect(db.assetLocationHistory.delete({ where: { id: h.id } })).rejects.toThrow(/append-only/);
  });

  it('mencegah satu aset berada di dua pinjaman terbuka (anti pinjam ganda)', async () => {
    const f = await createFixture();
    const mkLoan = (n: string) =>
      db.loan.create({
        data: {
          number: n, borrowerPersonId: f.person.id, loanDate: new Date(), expectedReturnDate: new Date(),
          purpose: 'Uji', createdById: f.user.id,
        },
      });
    const l1 = await mkLoan('PJM-1');
    const l2 = await mkLoan('PJM-2');
    const d1 = await db.loanDetail.create({ data: { loanId: l1.id, assetId: f.asset.id, conditionBefore: 'GOOD' } });
    await expect(
      db.loanDetail.create({ data: { loanId: l2.id, assetId: f.asset.id, conditionBefore: 'GOOD' } }),
    ).rejects.toMatchObject({ code: 'P2002' });

    // Setelah pinjaman pertama selesai, aset boleh dipinjam lagi.
    await db.loanDetail.update({ where: { id: d1.id }, data: { isOpen: false } });
    await expect(
      db.loanDetail.create({ data: { loanId: l2.id, assetId: f.asset.id, conditionBefore: 'GOOD' } }),
    ).resolves.toBeTruthy();
  });

  it('kode aset dan nomor seri per master barang unik', async () => {
    const f = await createFixture();
    const base = { itemId: f.item.id, acquisitionYear: 2026, unitId: f.unit.id, locationId: f.location.id };
    await expect(db.asset.create({ data: { ...base, code: f.asset.code } })).rejects.toThrow(/Unique constraint/);
    await db.asset.create({ data: { ...base, code: 'INV-A', serialNumber: 'SN-1' } });
    await expect(db.asset.create({ data: { ...base, code: 'INV-B', serialNumber: 'SN-1' } })).rejects.toThrow(/Unique constraint/);
    // Tanpa nomor seri, beberapa unit diperbolehkan.
    await db.asset.create({ data: { ...base, code: 'INV-C' } });
    await expect(db.asset.create({ data: { ...base, code: 'INV-D' } })).resolves.toBeTruthy();
  });

  it('email pengguna harus huruf kecil', async () => {
    const f = await createFixture();
    await expect(
      db.user.create({ data: { organizationId: f.org.id, email: 'Besar@Uji.test', name: 'X', passwordHash: 'x' } }),
    ).rejects.toThrow(/users_email_lowercase/);
  });
});

describe('seed', () => {
  it('idempoten: dua kali dijalankan tidak menggandakan data', async () => {
    const run = () => execSync('pnpm exec tsx prisma/seed.ts', { env: process.env, stdio: 'pipe' });
    run();
    run();
    expect(await db.permission.count()).toBe(PERMISSIONS.length);
    expect(await db.role.count()).toBe(5);
    expect(await db.user.count()).toBe(1);
    const admin = await db.user.findFirstOrThrow({ include: { roles: { include: { role: true } } } });
    expect(admin.roles.map((r) => r.role.code)).toEqual(['SUPER_ADMIN']);
    expect(admin.mustChangePassword).toBe(true);
    expect(admin.passwordHash.startsWith('$argon2id$')).toBe(true);
    const sa = await db.role.findUniqueOrThrow({
      where: { code: 'SUPER_ADMIN' },
      include: { _count: { select: { permissions: true } } },
    });
    expect(sa._count.permissions).toBe(PERMISSIONS.length);
  });
});
