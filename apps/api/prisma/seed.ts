/**
 * Seed idempoten: aman dijalankan berulang kali.
 * - Permission dan role sistem: dibuat bila belum ada; relasi role-permission hanya DITAMBAH
 *   (kustomisasi admin tidak ditimpa).
 * - Super Admin bootstrap: dibuat hanya jika belum ada pengguna dengan email tersebut.
 */
import { PrismaClient } from '@prisma/client';
import { PERMISSIONS, ROLE_DEFINITIONS, ROLE_CODES } from '@sima/shared';
import { hashPassword } from '../src/lib/password';
import { loadEnv } from '../src/config/env';

const prisma = new PrismaClient();

async function main() {
  const env = loadEnv();

  for (const p of PERMISSIONS) {
    await prisma.permission.upsert({
      where: { code: p.code },
      update: { module: p.module, description: p.description },
      create: { code: p.code, module: p.module, description: p.description },
    });
  }
  const permissions = await prisma.permission.findMany();
  const permissionId = new Map(permissions.map((p) => [p.code, p.id]));

  for (const def of ROLE_DEFINITIONS) {
    const role = await prisma.role.upsert({
      where: { code: def.code },
      update: { name: def.name, description: def.description, isSystem: true },
      create: { code: def.code, name: def.name, description: def.description, isSystem: true },
    });
    await prisma.rolePermission.createMany({
      data: def.permissions.map((code) => ({ roleId: role.id, permissionId: permissionId.get(code)! })),
      skipDuplicates: true,
    });
  }

  const org = await prisma.organization.upsert({
    where: { code: env.ORG_CODE },
    update: {},
    create: { code: env.ORG_CODE, name: env.ORG_NAME },
  });

  await prisma.organizationalUnit.upsert({
    where: { code: 'UNIT-UTAMA' },
    update: {},
    create: { code: 'UNIT-UTAMA', name: 'Sekretariat', organizationId: org.id },
  });

  for (const u of [
    ['PCS', 'Pcs'],
    ['UNIT', 'Unit'],
    ['SET', 'Set'],
    ['BOX', 'Box'],
    ['RIM', 'Rim'],
    ['BTL', 'Botol'],
    ['PAK', 'Pak'],
  ] as const) {
    await prisma.unitOfMeasure.upsert({ where: { code: u[0] }, update: {}, create: { code: u[0], name: u[1] } });
  }

  for (const c of [
    ['ELK', 'Elektronik'],
    ['FUR', 'Furnitur'],
    ['KND', 'Kendaraan'],
    ['ATK', 'Alat Tulis Kantor'],
    ['KEB', 'Perlengkapan Kebersihan'],
  ] as const) {
    await prisma.category.upsert({
      where: { code: c[0] },
      update: {},
      create: { code: c[0], codePrefix: c[0], name: c[1] },
    });
  }

  for (const f of [
    ['ANGGARAN', 'Anggaran Instansi'],
    ['HIBAH', 'Hibah'],
    ['LAINNYA', 'Sumber Lainnya'],
  ] as const) {
    await prisma.fundingSource.upsert({ where: { code: f[0] }, update: {}, create: { code: f[0], name: f[1] } });
  }

  await prisma.warehouse.upsert({
    where: { code: 'GDG-UTAMA' },
    update: {},
    create: { code: 'GDG-UTAMA', name: 'Gudang Utama' },
  });

  const email = env.BOOTSTRAP_ADMIN_EMAIL.toLowerCase();
  const existing = await prisma.user.findUnique({ where: { email } });
  if (!existing) {
    if (!env.BOOTSTRAP_ADMIN_PASSWORD) {
      throw new Error('BOOTSTRAP_ADMIN_PASSWORD wajib diisi (min. 10 karakter) untuk membuat Super Admin pertama.');
    }
    const superAdmin = await prisma.role.findUniqueOrThrow({ where: { code: ROLE_CODES.SUPER_ADMIN } });
    await prisma.user.create({
      data: {
        organizationId: org.id,
        email,
        name: env.BOOTSTRAP_ADMIN_NAME,
        passwordHash: await hashPassword(env.BOOTSTRAP_ADMIN_PASSWORD),
        mustChangePassword: true,
        roles: { create: { roleId: superAdmin.id } },
      },
    });
    console.log(`Super Admin dibuat: ${email} (wajib ganti password saat login pertama)`);
  } else {
    console.log(`Super Admin ${email} sudah ada, dilewati`);
  }

  console.log(`Seed selesai: ${PERMISSIONS.length} permission, ${ROLE_DEFINITIONS.length} role`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
