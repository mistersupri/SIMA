import { z } from 'zod';

/** Bentuk respons API yang konsisten untuk seluruh endpoint /api/v1. */
export interface ApiSuccess<T> {
  success: true;
  message: string;
  data: T;
  meta: PaginationMeta | null;
}

export interface ApiFieldError {
  field: string;
  message: string;
}

export interface ApiFailure {
  success: false;
  message: string;
  errors?: ApiFieldError[];
}

export interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export const paginationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().trim().max(200).optional(),
  sortBy: z.string().max(50).optional(),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
});
export type PaginationQuery = z.infer<typeof paginationQuerySchema>;
