import { useQuery } from '@tanstack/react-query';
import { api, buildQuery } from '@/lib/api';

export interface Option {
  id: string;
  name: string;
  code?: string;
  [k: string]: unknown;
}

/** Opsi dropdown dari resource aktif (maks. 100, cukup untuk skala instansi tunggal). */
export function useOptions(path: string, params: Record<string, string | number | boolean> = {}) {
  return useQuery({
    queryKey: ['options', path, params],
    queryFn: async () => (await api.get<Option[]>(`${path}${buildQuery({ limit: 100, isActive: true, ...params })}`)).data,
    staleTime: 30_000,
  });
}

export const optionLabel = (o: Option) => (o.code ? `${o.code} · ${o.name}` : o.name);
