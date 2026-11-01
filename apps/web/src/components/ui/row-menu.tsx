import * as Menu from '@radix-ui/react-dropdown-menu';
import { MoreHorizontal } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from './button';

export interface RowMenuItem {
  label: string;
  onSelect: () => void;
  danger?: boolean;
  hidden?: boolean;
  disabled?: boolean;
}

export function RowMenu({ label, items }: { label: string; items: RowMenuItem[] }) {
  const visible = items.filter((i) => !i.hidden);
  if (!visible.length) return null;
  return (
    <Menu.Root>
      <Menu.Trigger asChild>
        <Button variant="ghost" size="icon" aria-label={label}>
          <MoreHorizontal className="size-4" aria-hidden />
        </Button>
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Content align="end" sideOffset={4} className="z-50 min-w-44 rounded-card border border-line bg-surface p-1 shadow-lg data-[state=open]:animate-[fade-in_120ms_ease-out]">
          {visible.map((i) => (
            <Menu.Item
              key={i.label}
              disabled={i.disabled}
              onSelect={i.onSelect}
              className={cn(
                'flex min-h-11 cursor-pointer items-center rounded-control px-3 text-sm outline-none data-[disabled]:opacity-50 data-[highlighted]:bg-wash sm:min-h-9',
                i.danger && 'text-danger-ink data-[highlighted]:bg-danger-wash',
              )}
            >
              {i.label}
            </Menu.Item>
          ))}
        </Menu.Content>
      </Menu.Portal>
    </Menu.Root>
  );
}
