import { useNavigate } from 'react-router';
import * as Pop from '@radix-ui/react-popover';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell } from 'lucide-react';
import { approvalEntityPath, type ApprovalEntityType } from '@sima/shared';
import { api } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { ErrorState, Spinner } from '@/components/ui/misc';

interface Notif { id: string; type: string; title: string; body: string | null; entityType: string | null; entityId: string | null; readAt: string | null; createdAt: string }

function targetOf(n: Notif): string | null {
  if (!n.entityType || !n.entityId) return null;
  if (n.entityType === 'ITEM') return `/persediaan/${n.entityId}`;
  if (n.entityType === 'GOODS_RECEIPT') return '/penerimaan';
  if (['PROCUREMENT', 'MUTATION', 'LOAN', 'MAINTENANCE', 'STOCK_ADJUSTMENT', 'DISPOSAL'].includes(n.entityType)) return approvalEntityPath(n.entityType as ApprovalEntityType, n.entityId);
  return null;
}

export function NotificationBell() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const count = useQuery({ queryKey: ['notifications', 'count'], queryFn: async () => (await api.get<{ count: number }>('/notifications/unread-count')).data.count, refetchInterval: 30_000 });
  const list = useQuery({ queryKey: ['notifications', 'list'], queryFn: async () => (await api.get<Notif[]>('/notifications?limit=15')).data });
  const refresh = () => qc.invalidateQueries({ queryKey: ['notifications'] });
  const readAll = useMutation({ mutationFn: () => api.post('/notifications/read-all'), onSuccess: refresh });
  const unread = count.data ?? 0;

  return (
    <Pop.Root onOpenChange={(o) => o && void refresh()}>
      <Pop.Trigger asChild>
        <button type="button" aria-label={unread ? `Notifikasi, ${unread} belum dibaca` : 'Notifikasi'} className="relative grid size-11 place-items-center rounded-control transition-colors duration-150 hover:bg-wash data-[state=open]:bg-wash sm:size-9">
          <Bell className="size-5" aria-hidden />
          {unread > 0 && <span className="absolute top-1 right-1 min-w-4 rounded-full bg-danger-ink px-1 text-center text-[10px] leading-4 font-semibold text-white">{unread > 99 ? '99+' : unread}</span>}
        </button>
      </Pop.Trigger>
      <Pop.Portal>
        <Pop.Content align="end" sideOffset={6} className="z-50 w-[min(24rem,calc(100vw-1.5rem))] rounded-card border border-line bg-surface shadow-lg data-[state=open]:animate-[fade-in_120ms_ease-out]">
          <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
            <h2 className="text-sm font-semibold">Notifikasi</h2>
            <Button variant="ghost" size="sm" disabled={!unread || readAll.isPending} onClick={() => readAll.mutate()}>Tandai semua dibaca</Button>
          </div>
          <div className="max-h-96 overflow-y-auto">
            {list.isPending && <div className="py-8 text-center"><Spinner /></div>}
            {list.error && <ErrorState message={list.error.message} onRetry={() => void list.refetch()} />}
            {list.data?.length === 0 && <p className="px-4 py-10 text-center text-sm text-muted">Belum ada notifikasi.</p>}
            <ul>
              {list.data?.map((n) => (
                <li key={n.id} className="border-b border-line last:border-0">
                  <Pop.Close asChild>
                    <button type="button" className={cn('flex min-h-11 w-full flex-col items-start gap-0.5 px-4 py-2.5 text-left text-sm transition-colors duration-150 hover:bg-canvas', !n.readAt && 'bg-blue-50/60')}
                      onClick={async () => { if (!n.readAt) await api.post(`/notifications/${n.id}/read`).catch(() => undefined); void refresh(); const to = targetOf(n); if (to) navigate(to); }}>
                      <span className={cn(!n.readAt && 'font-semibold')}>{n.title}</span>
                      {n.body && <span className="line-clamp-2 text-muted">{n.body}</span>}
                      <span className="text-xs text-muted">{formatDateTime(n.createdAt)}</span>
                    </button>
                  </Pop.Close>
                </li>
              ))}
            </ul>
          </div>
        </Pop.Content>
      </Pop.Portal>
    </Pop.Root>
  );
}
