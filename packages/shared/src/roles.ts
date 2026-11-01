import { ALL_PERMISSION_CODES, type PermissionCode } from './permissions';

export const ROLE_CODES = {
  SUPER_ADMIN: 'SUPER_ADMIN',
  ADMIN_INVENTARIS: 'ADMIN_INVENTARIS',
  PETUGAS_INVENTARIS: 'PETUGAS_INVENTARIS',
  APPROVER: 'APPROVER',
  VIEWER: 'VIEWER',
} as const;
export type RoleCode = (typeof ROLE_CODES)[keyof typeof ROLE_CODES];

export interface RoleDefinition {
  code: RoleCode;
  name: string;
  description: string;
  permissions: PermissionCode[];
}

const isView = (c: PermissionCode) => c.endsWith('.view');
const isApprovalDecision = (c: PermissionCode) => c.endsWith('.approve') || c.endsWith('.reject');
const SYSTEM_ONLY: PermissionCode[] = ['users.manage', 'roles.manage', 'settings.manage'];

const viewPermissions = ALL_PERMISSION_CODES.filter(isView);

/** Admin Inventaris: seluruh operasi data, kecuali keputusan persetujuan dan pengaturan sistem. */
const adminPermissions = ALL_PERMISSION_CODES.filter(
  (c) => !isApprovalDecision(c) && !SYSTEM_ONLY.includes(c),
);

/** Petugas: input dan transaksi operasional, tanpa arsip, master data, persetujuan, import massal. */
const petugasPermissions: PermissionCode[] = [
  'dashboard.view',
  'master.view',
  'items.view',
  'items.create',
  'items.update',
  'assets.view',
  'assets.create',
  'assets.update',
  'assets.print_qr',
  'assets.export',
  'stocks.view',
  'stocks.in',
  'stocks.out',
  'stock_adjustments.view',
  'stock_adjustments.create',
  'stock_adjustments.submit',
  'procurements.view',
  'procurements.create',
  'procurements.update',
  'procurements.submit',
  'goods_receipts.view',
  'goods_receipts.create',
  'goods_receipts.confirm',
  'mutations.view',
  'mutations.create',
  'mutations.submit',
  'mutations.complete',
  'loans.view',
  'loans.create',
  'loans.submit',
  'loans.handover',
  'loans.return',
  'maintenances.view',
  'maintenances.create',
  'maintenances.submit',
  'maintenances.complete',
  'disposals.view',
  'disposals.create',
  'disposals.submit',
  'stock_opnames.view',
  'stock_opnames.scan',
  'stock_opnames.submit',
  'approvals.view',
  'reports.view',
];

/** Approver / Kepala Unit: melihat data dan memutuskan persetujuan. */
const approverPermissions: PermissionCode[] = [
  ...viewPermissions.filter((c) => !['users.view', 'roles.view', 'audit.view'].includes(c)),
  ...ALL_PERMISSION_CODES.filter(isApprovalDecision),
  'reports.export',
  'stock_opnames.verify',
];

/** Viewer / Auditor: hanya membaca, termasuk audit log dan export laporan. */
const viewerPermissions: PermissionCode[] = [
  ...viewPermissions,
  'reports.export',
  'assets.export',
  'items.export',
  'stocks.export',
];

export const ROLE_DEFINITIONS: RoleDefinition[] = [
  {
    code: ROLE_CODES.SUPER_ADMIN,
    name: 'Super Admin',
    description: 'Pengaturan sistem dan seluruh akses',
    permissions: ALL_PERMISSION_CODES,
  },
  {
    code: ROLE_CODES.ADMIN_INVENTARIS,
    name: 'Admin Inventaris',
    description: 'Mengelola data dan transaksi inventaris',
    permissions: adminPermissions,
  },
  {
    code: ROLE_CODES.PETUGAS_INVENTARIS,
    name: 'Petugas Inventaris',
    description: 'Input barang dan transaksi operasional',
    permissions: petugasPermissions,
  },
  {
    code: ROLE_CODES.APPROVER,
    name: 'Approver / Kepala Unit',
    description: 'Menyetujui atau menolak transaksi sesuai kewenangan',
    permissions: approverPermissions,
  },
  {
    code: ROLE_CODES.VIEWER,
    name: 'Viewer / Auditor',
    description: 'Melihat data dan laporan tanpa mengubah',
    permissions: viewerPermissions,
  },
];
