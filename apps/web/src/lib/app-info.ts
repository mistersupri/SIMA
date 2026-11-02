import { useQuery } from '@tanstack/react-query';
import { api } from './api';

/** Nama instansi untuk halaman login dan header. Endpoint publik; gagal/offline kembali ke "SIMA". */
export function useOrganizationName() {
  const q = useQuery({
    queryKey: ['app-info'],
    queryFn: async () => (await api.get<{ organizationName: string }>('/app-info')).data.organizationName,
    staleTime: 5 * 60_000,
    retry: false,
  });
  return q.data ?? null;
}
