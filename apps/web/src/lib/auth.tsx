import { createContext, useContext, useEffect, useMemo, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { AuthPayload, LoginInput, SessionUser } from '@sima/shared';
import { ApiError, api, setCsrfToken } from './api';

interface AuthState {
  user: SessionUser | null;
  loading: boolean;
  error: ApiError | null;
  can: (permission: string) => boolean;
  login: (input: LoginInput) => Promise<SessionUser>;
  logout: () => Promise<void>;
  refresh: () => Promise<unknown>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const me = useQuery({
    queryKey: ['me'],
    queryFn: async () => (await api.get<AuthPayload>('/auth/me')).data,
    retry: false,
    staleTime: 60_000,
  });

  useEffect(() => {
    setCsrfToken(me.data?.csrfToken ?? null);
  }, [me.data]);

  const loginMutation = useMutation({
    mutationFn: async (input: LoginInput) => (await api.post<AuthPayload>('/auth/login', input)).data,
    onSuccess: (data) => {
      setCsrfToken(data.csrfToken);
      qc.setQueryData(['me'], data);
    },
  });

  const logoutMutation = useMutation({
    mutationFn: () => api.post('/auth/logout'),
    onSettled: () => {
      setCsrfToken(null);
      qc.clear();
      qc.setQueryData(['me'], null);
    },
  });

  const value = useMemo<AuthState>(() => {
    const user = me.data?.user ?? null;
    const permissions = new Set(user?.permissions ?? []);
    const unauthenticated = me.error instanceof ApiError && me.error.status === 401;
    return {
      user,
      loading: me.isPending,
      // 401 berarti belum login, bukan galat. Galat lain (server mati) ditampilkan.
      error: me.error && !unauthenticated ? (me.error as ApiError) : null,
      can: (p) => permissions.has(p),
      login: async (input) => (await loginMutation.mutateAsync(input)).user,
      logout: async () => {
        await logoutMutation.mutateAsync().catch(() => undefined);
      },
      refresh: () => me.refetch(),
    };
  }, [me.data, me.error, me.isPending, me.refetch, loginMutation, logoutMutation]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth harus dipakai di dalam AuthProvider');
  return ctx;
}
