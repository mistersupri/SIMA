import { Database, ShieldCheck, Users, type LucideIcon } from 'lucide-react';

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
    title: 'Pengaturan',
    items: [
      { to: '/pengaturan/pengguna', label: 'Pengguna', icon: Users, permission: 'users.view', match: '/pengaturan/pengguna' },
      { to: '/pengaturan/role', label: 'Role dan Permission', icon: ShieldCheck, permission: 'roles.view', match: '/pengaturan/role' },
      { to: '/master/organizational-units', label: 'Master Data', icon: Database, permission: 'master.view', match: '/master' },
    ],
  },
];
