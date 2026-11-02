import { ArrowRightLeft, ClipboardList, Trash2, Wrench, Boxes, ClipboardCheck, Database, HandCoins, History, PackageCheck, ReceiptText, Package, ScanLine, ShieldCheck, Users, Warehouse, type LucideIcon } from 'lucide-react';

export interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  permission: string;
  /** Prefiks path yang menandai item ini aktif. */
  match: string;
}

export interface NavGroup {
  title: string;
  items: NavItem[];
}

// Hanya halaman yang benar-benar ada. Menu baru ditambahkan bersama modulnya.
export const NAV: NavGroup[] = [
  {
    title: 'Inventaris',
    items: [
      { to: '/barang', label: 'Data Barang', icon: Package, permission: 'items.view', match: '/barang' },
      { to: '/aset', label: 'Aset', icon: Boxes, permission: 'assets.view', match: '/aset' },
      { to: '/scan', label: 'Scan QR', icon: ScanLine, permission: 'assets.view', match: '/scan' },
      { to: '/persediaan', label: 'Persediaan', icon: Warehouse, permission: 'stocks.view', match: '/persediaan' },
    ],
  },
  {
    title: 'Transaksi',
    items: [
      { to: '/pengadaan', label: 'Pengadaan', icon: ReceiptText, permission: 'procurements.view', match: '/pengadaan' },
      { to: '/penerimaan', label: 'Penerimaan Barang', icon: PackageCheck, permission: 'goods_receipts.view', match: '/penerimaan' },
      { to: '/mutasi', label: 'Mutasi', icon: ArrowRightLeft, permission: 'mutations.view', match: '/mutasi' },
      { to: '/peminjaman', label: 'Peminjaman', icon: HandCoins, permission: 'loans.view', match: '/peminjaman' },
    ],
  },
  {
    title: 'Pemeliharaan',
    items: [
      { to: '/pemeliharaan', label: 'Data Pemeliharaan', icon: Wrench, permission: 'maintenances.view', match: '/pemeliharaan' },
      { to: '/perbaikan/riwayat', label: 'Riwayat Perbaikan', icon: History, permission: 'maintenances.view', match: '/perbaikan/riwayat' },
    ],
  },
  {
    title: 'Pemeriksaan',
    items: [{ to: '/opname', label: 'Stock Opname', icon: ClipboardList, permission: 'stock_opnames.view', match: '/opname' }],
  },
  {
    title: 'Penghapusan',
    items: [
      { to: '/penghapusan', label: 'Pengajuan', icon: Trash2, permission: 'disposals.view', match: '/penghapusan' },
      { to: '/penghapusan-riwayat', label: 'Riwayat Penghapusan', icon: History, permission: 'disposals.view', match: '/penghapusan-riwayat' },
    ],
  },
  {
    title: 'Persetujuan',
    items: [
      { to: '/persetujuan/menunggu', label: 'Menunggu Persetujuan', icon: ClipboardCheck, permission: 'approvals.view', match: '/persetujuan/menunggu' },
      { to: '/persetujuan/riwayat', label: 'Riwayat Persetujuan', icon: History, permission: 'approvals.view', match: '/persetujuan/riwayat' },
    ],
  },
  {
    title: 'Pengaturan',
    items: [
      { to: '/pengaturan/pengguna', label: 'Pengguna', icon: Users, permission: 'users.view', match: '/pengaturan/pengguna' },
      { to: '/pengaturan/role', label: 'Role dan Permission', icon: ShieldCheck, permission: 'roles.view', match: '/pengaturan/role' },
      { to: '/master/organizational-units', label: 'Master Data', icon: Database, permission: 'master.view', match: '/master' },
    ],
  },
];
