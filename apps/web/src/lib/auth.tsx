import { createContext, useContext, useEffect, useMemo, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { AuthPayload, LoginInput, SessionUser } from '@sima/shared';
import { ApiError, api, setCsrfToken } from './api';

const CACHE_KEY = 'sima:me';
/** Profil terakhir disimpan di perangkat (tanpa token) agar aplikasi tetap terbuka saat offline. Server tetap memeriksa semua izin. */
const readCached = (): SessionUser | null => { try { const raw = localStorage.getItem(CACHE_KEY); return raw ? (JSON.parse(raw) as SessionUser) : null; } catch { return null; } };
const writeCached = (u: SessionUser | null) => { try { if (u) localStorage.setItem(CACHE_KEY, JSON.stringify(u)); else localStorage.removeItem(CACHE_KEY); } catch { /* penyimpanan diblokir */ } };

interface AuthState {
  offline: boolean;
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
    if (me.data) writeCached(me.data.user);
  }, [me.data]);

  // Sesi berakhir di server: hapus profil tersimpan.
  useEffect(() => {
    if (me.error instanceof ApiError && me.error.status === 401) writeCached(null);
  }, [me.error]);

  // Kembali online: muat ulang sesi agar token CSRF tersedia lagi.
  useEffect(() => {
    const on = () => void me.refetch();
    window.addEventListener('online', on);
    return () => window.removeEventListener('online', on);
  }, [me.refetch]);

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
      writeCached(null);
      qc.clear();
      qc.setQueryData(['me'], null);
    },
  });

  const value = useMemo<AuthState>(() => {
    const networkDown = me.error instanceof ApiError && me.error.status === 0;
    const cached = networkDown ? readCached() : null;
    const offline = !me.data && !!cached;
    const user = me.data?.user ?? cached;
    const permissions = new Set(user?.permissions ?? []);
    const unauthenticated = me.error instanceof ApiError && me.error.status === 401;
    return {
      user,
      offline,
      loading: me.isPending,
      // 401 berarti belum login, bukan galat. Galat jaringan dengan profil tersimpan = mode offline, bukan galat.
      error: me.error && !unauthenticated && !offline ? (me.error as ApiError) : null,
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
