import { useEffect, useState } from 'react';

export interface ListState {
  page: number;
  limit: number;
  search: string;
  sortBy?: string;
  sortOrder: 'asc' | 'desc';
  filters: Record<string, string>;
}

/** State daftar sisi-server: pencarian di-debounce 300 ms dan mereset halaman. */
export function useListState(defaults: { sortBy?: string; sortOrder?: 'asc' | 'desc'; limit?: number; filters?: Record<string, string> } = {}) {
  const [state, setState] = useState<ListState>({
    page: 1,
    limit: defaults.limit ?? 20,
    search: '',
    sortBy: defaults.sortBy,
    sortOrder: defaults.sortOrder ?? 'asc',
    filters: defaults.filters ?? {},
  });
  const [searchInput, setSearchInput] = useState('');

  useEffect(() => {
    const t = setTimeout(() => setState((s) => (s.search === searchInput.trim() ? s : { ...s, search: searchInput.trim(), page: 1 })), 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  return {
    state,
    searchInput,
    setSearchInput,
    setPage: (page: number) => setState((s) => ({ ...s, page })),
    setLimit: (limit: number) => setState((s) => ({ ...s, limit, page: 1 })),
    setFilter: (key: string, value: string) => setState((s) => ({ ...s, filters: { ...s.filters, [key]: value }, page: 1 })),
    toggleSort: (key: string) =>
      setState((s) => ({ ...s, sortBy: key, sortOrder: s.sortBy === key && s.sortOrder === 'asc' ? 'desc' : 'asc', page: 1 })),
  };
}
