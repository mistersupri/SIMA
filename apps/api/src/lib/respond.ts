import type { ApiSuccess, PaginationMeta } from '@sima/shared';

export function ok<T>(data: T, message = 'Data berhasil diproses', meta: PaginationMeta | null = null): ApiSuccess<T> {
  return { success: true, message, data, meta };
}

export function paginated<T>(
  rows: T[],
  total: number,
  page: number,
  limit: number,
  message = 'Data berhasil dimuat',
): ApiSuccess<T[]> {
  return ok(rows, message, { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) });
}
