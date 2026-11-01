import type { ReactNode } from 'react';
import * as D from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from './button';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
  className?: string;
}

/** Dialog modal: Escape menutup, fokus terkunci di dalam, fade+scale 150ms dari 0.97. */
export function Dialog({ open, onOpenChange, title, description, children, footer, className }: Props) {
  return (
    <D.Root open={open} onOpenChange={onOpenChange}>
      <D.Portal>
        <D.Overlay className="fixed inset-0 z-40 bg-navy/40 data-[state=open]:animate-[fade-in_150ms_ease-out]" />
        <D.Content
          aria-describedby={description ? undefined : undefined}
          className={cn(
            'fixed top-1/2 left-1/2 z-50 flex max-h-[90dvh] w-[calc(100vw-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 flex-col rounded-card border border-line bg-surface shadow-xl data-[state=open]:animate-[dialog-in_150ms_ease-out]',
            className,
          )}
        >
          <header className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
            <div>
              <D.Title className="text-base font-semibold text-navy">{title}</D.Title>
              {description && <D.Description className="mt-1 text-sm text-muted">{description}</D.Description>}
            </div>
            <D.Close asChild>
              <Button variant="ghost" size="icon" aria-label="Tutup" className="-mt-1 -mr-2">
                <X className="size-4" aria-hidden />
              </Button>
            </D.Close>
          </header>
          <div className="overflow-y-auto px-5 py-4">{children}</div>
          {footer && <footer className="flex flex-wrap justify-end gap-2 border-t border-line px-5 py-3">{footer}</footer>}
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}

export { Dialog as Modal };
