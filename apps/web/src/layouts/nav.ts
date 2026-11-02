import { FileUp, BarChart3, FileSpreadsheet, LayoutDashboard, ScrollText, ArrowRightLeft, ClipboardList, Trash2, Wrench, Boxes, ClipboardCheck, Database, HandCoins, History, PackageCheck, ReceiptText, Package, ScanLine, ShieldCheck, Users, Warehouse, type LucideIcon } from 'lucide-react';

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
  { title: 'Ringkasan', items: [{ to: '/', label: 'Dashboard', icon: LayoutDashboard, permission: 'dashboard.view', match: '/' }] },
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
    title: 'Laporan',
    items: [
      { to: '/laporan/assets', label: 'Inventaris', icon: BarChart3, permission: 'reports.view', match: '/laporan/assets' },
      { to: '/laporan/stocks', label: 'Persediaan', icon: FileSpreadsheet, permission: 'reports.view', match: '/laporan/stocks' },
      { to: '/laporan/conditions', label: 'Kondisi', icon: FileSpreadsheet, permission: 'reports.view', match: '/laporan/conditions' },
      { to: '/laporan/mutations', label: 'Mutasi', icon: FileSpreadsheet, permission: 'reports.view', match: '/laporan/mutations' },
      { to: '/laporan/loans', label: 'Peminjaman', icon: FileSpreadsheet, permission: 'reports.view', match: '/laporan/loans' },
      { to: '/laporan/maintenances', label: 'Pemeliharaan', icon: FileSpreadsheet, permission: 'reports.view', match: '/laporan/maintenances' },
      { to: '/laporan/procurements', label: 'Pengadaan', icon: FileSpreadsheet, permission: 'reports.view', match: '/laporan/procurements' },
      { to: '/laporan/disposals', label: 'Penghapusan', icon: FileSpreadsheet, permission: 'reports.view', match: '/laporan/disposals' },
      { to: '/laporan/stock-opnames', label: 'Stock Opname', icon: FileSpreadsheet, permission: 'reports.view', match: '/laporan/stock-opnames' },
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
      { to: '/impor', label: 'Impor Excel', icon: FileUp, permission: 'items.import', match: '/impor' },
      { to: '/pengaturan/audit-log', label: 'Audit Log', icon: ScrollText, permission: 'audit.view', match: '/pengaturan/audit-log' },
      { to: '/master/organizational-units', label: 'Master Data', icon: Database, permission: 'master.view', match: '/master' },
    ],
  },
];
