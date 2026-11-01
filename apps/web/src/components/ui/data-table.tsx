import type { ReactNode } from 'react';
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight } from 'lucide-react';
import type { PaginationMeta } from '@sima/shared';
import { cn } from '@/lib/utils';
import { Button } from './button';
import { Select } from './form';
import { Card, EmptyState, ErrorState, Spinner } from './misc';

export interface Column<T> {
  key: string;
  header: string;
  sortable?: boolean;
  className?: string;
  cell: (row: T) => ReactNode;
}

interface Props<T> {
  columns: Column<T>[];
  rows: T[] | undefined;
  rowKey: (row: T) => string;
  loading: boolean;
  error?: string | null;
  onRetry?: () => void;
  meta?: PaginationMeta | null;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
  onSort?: (key: string) => void;
  onPage: (page: number) => void;
  onLimit: (limit: number) => void;
  empty: { title: string; description?: string; action?: ReactNode };
  caption: string;
}

export function DataTable<T>({ columns, rows, rowKey, loading, error, onRetry, meta, sortBy, sortOrder, onSort, onPage, onLimit, empty, caption }: Props<T>) {
  return (
    <Card>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] border-collapse text-left text-sm">
          <caption className="sr-only">{caption}</caption>
          <thead>
            <tr className="border-b border-line bg-wash text-muted">
              {columns.map((c) => {
                const active = sortBy === c.key;
                return (
                  <th
                    key={c.key}
                    scope="col"
                    aria-sort={active ? (sortOrder === 'asc' ? 'ascending' : 'descending') : undefined}
                    className={cn('px-4 py-2.5 font-medium whitespace-nowrap', c.className)}
                  >
                    {c.sortable && onSort ? (
                      <button type="button" onClick={() => onSort(c.key)} className="-mx-1 inline-flex min-h-8 items-center gap-1 rounded-tag px-1 hover:text-ink">
                        {c.header}
                        {active && (sortOrder === 'asc' ? <ArrowUp className="size-3.5" aria-hidden /> : <ArrowDown className="size-3.5" aria-hidden />)}
                      </button>
                    ) : (
                      c.header
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody aria-busy={loading}>
            {rows?.map((row) => (
              <tr key={rowKey(row)} className={cn('border-b border-line last:border-0 hover:bg-canvas', loading && 'opacity-60')}>
                {columns.map((c) => (
                  <td key={c.key} className={cn('px-4 py-3 align-middle', c.className)}>
                    {c.cell(row)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {loading && !rows && (
        <div className="flex justify-center px-4 py-12">
          <Spinner label="Memuat data…" />
        </div>
      )}
      {error && !rows && <ErrorState message={error} onRetry={onRetry} />}
      {!loading && !error && rows?.length === 0 && <EmptyState {...empty} />}

      {meta && meta.total > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-4 py-3 text-sm text-muted">
          <div className="flex items-center gap-2">
            <label htmlFor="rows-per-page">Baris per halaman</label>
            <Select id="rows-per-page" className="w-20" value={meta.limit} onChange={(e) => onLimit(Number(e.target.value))}>
              {[10, 20, 50, 100].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </Select>
          </div>
          <div className="flex items-center gap-2">
            <span aria-live="polite">
              Halaman {meta.page} dari {meta.totalPages} ({meta.total} data)
            </span>
            <Button variant="secondary" size="icon" aria-label="Halaman sebelumnya" disabled={meta.page <= 1} onClick={() => onPage(meta.page - 1)}>
              <ChevronLeft className="size-4" aria-hidden />
            </Button>
            <Button variant="secondary" size="icon" aria-label="Halaman berikutnya" disabled={meta.page >= meta.totalPages} onClick={() => onPage(meta.page + 1)}>
              <ChevronRight className="size-4" aria-hidden />
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}
