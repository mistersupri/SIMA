import { PrismaClient } from '@prisma/client';

export const db = new PrismaClient();

export async function resetDb() {
  const rows = await db.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  const list = rows.map((r) => `"${r.tablename}"`).join(', ');
  await db.$executeRawUnsafe(`TRUNCATE ${list} RESTART IDENTITY CASCADE`);
}

let counter = 0;
const uid = () => `${Date.now().toString(36)}${(counter++).toString(36)}`.toUpperCase();

/** Fixture minimum: satu aset siap pakai beserta master pendukungnya. */
export async function createFixture() {
  const s = uid();
  const org = await db.organization.create({ data: { code: `ORG-${s}`, name: 'Instansi Uji' } });
  const unit = await db.organizationalUnit.create({
    data: { code: `U-${s}`, name: 'Unit Uji', organizationId: org.id },
  });
  const location = await db.location.create({ data: { code: `L-${s}`, name: 'Ruang Uji', unitId: unit.id } });
  const category = await db.category.create({ data: { code: `C${s}`, codePrefix: `P${s}`, name: 'Kategori Uji' } });
  const uom = await db.unitOfMeasure.create({ data: { code: `UM-${s}`, name: 'Unit' } });
  const item = await db.item.create({
    data: { code: `BRG-${s}`, name: 'Laptop Uji', type: 'ASSET', categoryId: category.id, unitOfMeasureId: uom.id },
  });
  const supply = await db.item.create({
    data: { code: `PRS-${s}`, name: 'Kertas Uji', type: 'SUPPLY', categoryId: category.id, unitOfMeasureId: uom.id },
  });
  const warehouse = await db.warehouse.create({ data: { code: `W-${s}`, name: 'Gudang Uji' } });
  const person = await db.person.create({ data: { name: 'Peminjam Uji', unitId: unit.id } });
  const user = await db.user.create({
    data: { organizationId: org.id, email: `u-${s.toLowerCase()}@uji.test`, name: 'Pengguna Uji', passwordHash: 'x' },
  });
  const asset = await db.asset.create({
    data: {
      code: `INV-TST-2026-${s}`,
      itemId: item.id,
      acquisitionYear: 2026,
      unitId: unit.id,
      locationId: location.id,
    },
  });
  return { org, unit, location, category, uom, item, supply, warehouse, person, user, asset, s };
}
