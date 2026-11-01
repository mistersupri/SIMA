import { paginationQuerySchema } from '@sima/shared';

/** Parse query daftar standar + batasi kolom sort ke whitelist (anti injeksi orderBy). */
export function parseListQuery(query: unknown, sortable: string[], defaultSort: string, defaultOrder: 'asc' | 'desc' = 'asc') {
  const q = paginationQuerySchema.parse(query);
  const sortBy = q.sortBy && sortable.includes(q.sortBy) ? q.sortBy : defaultSort;
  const sortOrder = q.sortBy ? q.sortOrder : defaultOrder;
  return {
    page: q.page,
    limit: q.limit,
    search: q.search || undefined,
    skip: (q.page - 1) * q.limit,
    take: q.limit,
    orderBy: { [sortBy]: sortOrder } as Record<string, 'asc' | 'desc'>,
  };
}

export const parseBool = (v: unknown): boolean | undefined =>
  v === 'true' ? true : v === 'false' ? false : undefined;
