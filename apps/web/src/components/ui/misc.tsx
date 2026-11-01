import type { ReactNode } from 'react';
import { AlertTriangle, Inbox, LoaderCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from './button';

const tones = {
  neutral: 'bg-wash text-muted border-line',
  success: 'bg-success-wash text-success-ink border-success/30',
  warning: 'bg-warning-wash text-warning-ink border-warning/30',
  danger: 'bg-danger-wash text-danger-ink border-danger/30',
  info: 'bg-blue-50 text-blue-800 border-blue-200',
} as const;

export function Badge({ tone = 'neutral', children }: { tone?: keyof typeof tones; children: ReactNode }) {
  return <span className={cn('inline-flex items-center rounded-tag border px-1.5 py-0.5 text-xs font-medium', tones[tone])}>{children}</span>;
}

/** Cap kode: motif identitas untuk kode inventaris dan nomor dokumen. */
export function CodeStamp({ children }: { children: ReactNode }) {
  return <span className="code-stamp">{children}</span>;
}

export function Spinner({ label = 'Memuat…' }: { label?: string }) {
  return (
    <span role="status" className="inline-flex items-center gap-2 text-muted">
      <LoaderCircle className="size-4 animate-spin" aria-hidden />
      {label}
    </span>
  );
}

export function EmptyState({ title, description, action }: { title: string; description?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 px-4 py-12 text-center">
      <Inbox className="size-8 text-muted" aria-hidden />
      <p className="font-medium">{title}</p>
      {description && <p className="max-w-sm text-sm text-muted">{description}</p>}
      {action}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="flex flex-col items-center gap-3 px-4 py-12 text-center">
      <AlertTriangle className="size-8 text-danger-ink" aria-hidden />
      <p className="font-medium text-danger-ink">{message}</p>
      {onRetry && (
        <Button variant="secondary" size="sm" onClick={onRetry}>
          Coba lagi
        </Button>
      )}
    </div>
  );
}

export function PageHeader({ title, description, actions }: { title: string; description?: string; actions?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 className="text-xl font-semibold text-navy">{title}</h1>
        {description && <p className="mt-1 text-sm text-muted">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return <section className={cn('rounded-card border border-line bg-surface', className)}>{children}</section>;
}
