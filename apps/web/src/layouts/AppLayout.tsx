import { useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router';
import * as Dialog from '@radix-ui/react-dialog';
import * as Menu from '@radix-ui/react-dropdown-menu';
import { KeyRound, LogOut, Menu as MenuIcon, X } from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { NAV } from './nav';
import { NotificationBell } from '@/features/notifications/NotificationBell';

function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join('');
}

function SidebarNav({ onNavigate }: { onNavigate?: () => void }) {
  const { can } = useAuth();
  const { pathname } = useLocation();
  const groups = NAV.map((g) => ({ ...g, items: g.items.filter((i) => can(i.permission)) })).filter((g) => g.items.length);
  return (
    <nav aria-label="Navigasi utama" className="flex-1 overflow-y-auto px-3 py-4">
      {groups.map((g) => (
        <div key={g.title} className="mb-5">
          <p className="mb-1.5 px-3 text-xs font-medium text-slate-300">{g.title}</p>
          <ul className="flex flex-col gap-0.5">
            {g.items.map((i) => {
              const active = pathname === i.match || pathname.startsWith(`${i.match}/`);
              return (
                <li key={i.to}>
                  <NavLink
                    to={i.to}
                    onClick={onNavigate}
                    aria-current={active ? 'page' : undefined}
                    className={cn(
                      'flex min-h-11 items-center gap-3 rounded-control px-3 text-sm text-slate-100 transition-colors duration-150 hover:bg-white/10 lg:min-h-9',
                      active && 'bg-white/15 font-semibold text-white',
                    )}
                  >
                    <i.icon className="size-4 shrink-0" aria-hidden />
                    {i.label}
                  </NavLink>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}

const Brand = () => (
  <Link to="/" className="flex h-14 items-center gap-3 px-5 text-white">
    <span className="text-lg font-semibold tracking-tight">SIMA</span>
    <span className="text-xs text-slate-300">Inventaris Barang</span>
  </Link>
);

export function AppLayout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [drawer, setDrawer] = useState(false);

  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[16rem_1fr] print:block">
      <aside className="sticky top-0 hidden h-dvh flex-col bg-navy lg:flex print:hidden">
        <Brand />
        <SidebarNav />
      </aside>

      <Dialog.Root open={drawer} onOpenChange={setDrawer}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-40 bg-navy/50 lg:hidden" />
          <Dialog.Content className="fixed inset-y-0 left-0 z-50 flex w-72 max-w-[85vw] flex-col bg-navy lg:hidden">
            <Dialog.Title className="sr-only">Menu navigasi</Dialog.Title>
            <Dialog.Description className="sr-only">Daftar halaman aplikasi</Dialog.Description>
            <div className="flex items-center justify-between pr-2">
              <Brand />
              <Dialog.Close asChild>
                <Button variant="ghost" size="icon" aria-label="Tutup menu" className="text-white hover:bg-white/10">
                  <X className="size-5" aria-hidden />
                </Button>
              </Dialog.Close>
            </div>
            <SidebarNav onNavigate={() => setDrawer(false)} />
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      <div className="flex min-w-0 flex-col">
        <header className="sticky top-0 z-30 flex h-14 print:hidden items-center justify-between gap-3 border-b border-line bg-surface px-4 lg:px-6">
          <Button variant="ghost" size="icon" className="lg:hidden" aria-label="Buka menu" onClick={() => setDrawer(true)}>
            <MenuIcon className="size-5" aria-hidden />
          </Button>
          <div className="ml-auto flex items-center gap-1">
            <NotificationBell />
            <Menu.Root>
              <Menu.Trigger asChild>
                <button
                  type="button"
                  aria-label={`Menu akun ${user?.name}`}
                  className="flex min-h-11 items-center gap-2.5 rounded-control px-2 transition-colors duration-150 hover:bg-wash data-[state=open]:bg-wash"
                >
                  <span className="flex size-8 items-center justify-center rounded-full bg-navy text-xs font-semibold text-white" aria-hidden>
                    {initials(user?.name ?? '?')}
                  </span>
                  <span className="hidden text-left sm:block">
                    <span className="block text-sm leading-tight font-medium">{user?.name}</span>
                    <span className="block text-xs leading-tight text-muted">{user?.roles.map((r) => r.name).join(', ')}</span>
                  </span>
                </button>
              </Menu.Trigger>
              <Menu.Portal>
                <Menu.Content align="end" sideOffset={6} className="z-50 min-w-52 rounded-card border border-line bg-surface p-1 shadow-lg data-[state=open]:animate-[fade-in_120ms_ease-out]">
                  <div className="px-3 py-2 text-xs text-muted">{user?.email}</div>
                  <Menu.Separator className="my-1 h-px bg-line" />
                  <Menu.Item onSelect={() => navigate('/ganti-password')} className="flex min-h-11 cursor-pointer items-center gap-2 rounded-control px-3 text-sm outline-none data-[highlighted]:bg-wash sm:min-h-9">
                    <KeyRound className="size-4" aria-hidden /> Ganti password
                  </Menu.Item>
                  <Menu.Item
                    onSelect={async () => {
                      await logout();
                      navigate('/login', { replace: true });
                    }}
                    className="flex min-h-11 cursor-pointer items-center gap-2 rounded-control px-3 text-sm text-danger-ink outline-none data-[highlighted]:bg-danger-wash sm:min-h-9"
                  >
                    <LogOut className="size-4" aria-hidden /> Keluar
                  </Menu.Item>
                </Menu.Content>
              </Menu.Portal>
            </Menu.Root>
          </div>
        </header>
        <main className="min-w-0 flex-1 p-4 lg:p-6 print:p-0">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
