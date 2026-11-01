import type { ApiFieldError } from '@sima/shared';

export class AppError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
    public readonly code: string = 'ERROR',
    public readonly errors?: ApiFieldError[],
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export const badRequest = (message: string, errors?: ApiFieldError[]) =>
  new AppError(400, message, 'BAD_REQUEST', errors);
export const unauthorized = (message = 'Silakan login terlebih dahulu') =>
  new AppError(401, message, 'UNAUTHORIZED');
export const forbidden = (message = 'Anda tidak memiliki akses untuk tindakan ini') =>
  new AppError(403, message, 'FORBIDDEN');
export const notFound = (message = 'Data tidak ditemukan') =>
  new AppError(404, message, 'NOT_FOUND');
export const conflict = (message: string, errors?: ApiFieldError[]) =>
  new AppError(409, message, 'CONFLICT', errors);
export const unprocessable = (message: string, errors?: ApiFieldError[]) =>
  new AppError(422, message, 'UNPROCESSABLE', errors);
