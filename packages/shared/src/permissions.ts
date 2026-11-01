/**
 * Katalog permission granular. Sumber tunggal untuk seed, backend (authorization)
 * dan frontend (hanya untuk menyembunyikan UI; backend tetap memeriksa).
 * Format: "<modul>.<aksi>".
 */
export const PERMISSION_MODULES = {
  dashboard: { label: 'Dashboard', actions: { view: 'Melihat dashboard' } },
  users: {
    label: 'Pengguna',
    actions: { view: 'Melihat pengguna', manage: 'Mengelola pengguna dan role pengguna' },
  },
  roles: {
    label: 'Role',
    actions: { view: 'Melihat role dan permission', manage: 'Mengelola role dan permission' },
  },
  settings: { label: 'Pengaturan', actions: { manage: 'Mengubah pengaturan aplikasi' } },
  audit: { label: 'Audit', actions: { view: 'Melihat audit log' } },
  master: {
    label: 'Master data',
    actions: { view: 'Melihat master data', manage: 'Mengelola master data' },
  },
  items: {
    label: 'Master barang',
    actions: {
      view: 'Melihat master barang',
      create: 'Menambah master barang',
      update: 'Mengubah master barang',
      archive: 'Mengarsipkan master barang',
      import: 'Import master barang',
      export: 'Export master barang',
    },
  },
  assets: {
    label: 'Aset inventaris',
    actions: {
      view: 'Melihat aset',
      create: 'Mendaftarkan aset',
      update: 'Mengubah aset',
      archive: 'Mengarsipkan aset',
      import: 'Import aset',
      export: 'Export aset',
      print_qr: 'Mencetak QR Code aset',
    },
  },
  stocks: {
    label: 'Persediaan',
    actions: {
      view: 'Melihat saldo dan kartu stok',
      in: 'Mencatat barang masuk',
      out: 'Mencatat barang keluar',
      import: 'Import saldo awal',
      export: 'Export persediaan',
    },
  },
  stock_adjustments: {
    label: 'Penyesuaian stok',
    actions: {
      view: 'Melihat penyesuaian stok',
      create: 'Membuat penyesuaian stok',
      submit: 'Mengajukan penyesuaian stok',
      approve: 'Menyetujui penyesuaian stok',
      reject: 'Menolak penyesuaian stok',
    },
  },
  procurements: {
    label: 'Pengadaan',
    actions: {
      view: 'Melihat pengadaan',
      create: 'Membuat pengadaan',
      update: 'Mengubah draft pengadaan',
      submit: 'Mengajukan pengadaan',
      approve: 'Menyetujui pengadaan',
      reject: 'Menolak pengadaan',
    },
  },
  goods_receipts: {
    label: 'Penerimaan barang',
    actions: {
      view: 'Melihat penerimaan',
      create: 'Mencatat penerimaan',
      confirm: 'Mengonfirmasi penerimaan',
    },
  },
  mutations: {
    label: 'Mutasi aset',
    actions: {
      view: 'Melihat mutasi',
      create: 'Membuat mutasi',
      submit: 'Mengajukan mutasi',
      approve: 'Menyetujui mutasi',
      reject: 'Menolak mutasi',
      complete: 'Mengonfirmasi penyelesaian mutasi',
    },
  },
  loans: {
    label: 'Peminjaman',
    actions: {
      view: 'Melihat peminjaman',
      create: 'Membuat peminjaman',
      submit: 'Mengajukan peminjaman',
      approve: 'Menyetujui peminjaman',
      reject: 'Menolak peminjaman',
      handover: 'Menyerahkan aset yang disetujui',
      return: 'Memproses pengembalian',
    },
  },
  maintenances: {
    label: 'Pemeliharaan',
    actions: {
      view: 'Melihat pemeliharaan',
      create: 'Melaporkan pemeliharaan',
      submit: 'Mengajukan pemeliharaan',
      approve: 'Menyetujui pemeliharaan',
      reject: 'Menolak pemeliharaan',
      complete: 'Menyelesaikan pemeliharaan',
    },
  },
  disposals: {
    label: 'Penghapusan aset',
    actions: {
      view: 'Melihat penghapusan',
      create: 'Membuat penghapusan',
      submit: 'Mengajukan penghapusan',
      approve: 'Menyetujui penghapusan',
      reject: 'Menolak penghapusan',
      complete: 'Memfinalisasi penghapusan',
    },
  },
  stock_opnames: {
    label: 'Stock opname',
    actions: {
      view: 'Melihat stock opname',
      create: 'Membuat sesi stock opname',
      scan: 'Memeriksa dan mencatat hasil scan',
      submit: 'Mengajukan hasil pemeriksaan',
      verify: 'Memverifikasi hasil pemeriksaan',
    },
  },
  approvals: { label: 'Persetujuan', actions: { view: 'Melihat daftar persetujuan' } },
  reports: {
    label: 'Laporan',
    actions: { view: 'Melihat laporan', export: 'Export laporan' },
  },
} as const;

type Modules = typeof PERMISSION_MODULES;
export type PermissionCode = {
  [M in keyof Modules]: `${M & string}.${keyof Modules[M]['actions'] & string}`;
}[keyof Modules];

export interface PermissionDefinition {
  code: PermissionCode;
  module: string;
  description: string;
}

export const PERMISSIONS: PermissionDefinition[] = Object.entries(PERMISSION_MODULES).flatMap(
  ([module, def]) =>
    Object.entries(def.actions).map(([action, description]) => ({
      code: `${module}.${action}` as PermissionCode,
      module,
      description: description as string,
    })),
);

export const ALL_PERMISSION_CODES: PermissionCode[] = PERMISSIONS.map((p) => p.code);

export function isPermissionCode(value: string): value is PermissionCode {
  return (ALL_PERMISSION_CODES as string[]).includes(value);
}
