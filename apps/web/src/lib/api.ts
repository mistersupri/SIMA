import type { ApiFailure, ApiSuccess } from '@sima/shared';

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public errors?: ApiFailure['errors'],
  ) {
    super(message);
  }
}

export async function apiGet<T>(path: string, signal?: AbortSignal): Promise<ApiSuccess<T>> {
  let res: Response;
  try {
    res = await fetch(`/api/v1${path}`, { credentials: 'include', signal });
  } catch {
    throw new ApiError(0, 'Tidak dapat terhubung ke server');
  }
  const body = (await res.json().catch(() => null)) as ApiSuccess<T> | ApiFailure | null;
  if (!res.ok || !body || body.success === false) {
    throw new ApiError(res.status, body?.message ?? 'Terjadi kesalahan', (body as ApiFailure | null)?.errors);
  }
  return body;
}
