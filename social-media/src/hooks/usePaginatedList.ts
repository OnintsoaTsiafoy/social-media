import { useCallback, useEffect, useRef, useState } from 'react';

import { toUserMessage } from '@/data/api';

export type Page<T> = { items: T[]; hasMore: boolean; total: number };

export type PaginatedList<T> = {
  items: T[];
  total: number;
  loading: boolean;
  refreshing: boolean;
  loadingMore: boolean;
  error: string | undefined;
  hasMore: boolean;
  refresh: () => Promise<void>;
  loadMore: () => void;
  reload: () => void;
  /** Applies a local patch so a row can update without a full refetch. */
  patchItem: (id: string, patch: Partial<T>) => void;
  removeItem: (id: string) => void;
};

/**
 * Paginated list state. Appends pages, de-duplicates by id, keeps the previous
 * items visible while refreshing, and never leaves the user without an
 * explanation on failure.
 */
export function usePaginatedList<T extends { id: string }>(
  fetchPage: (page: number) => Promise<Page<T>>,
  deps: React.DependencyList = []
): PaginatedList<T> {
  const [items, setItems] = useState<T[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const [hasMore, setHasMore] = useState(false);

  const page = useRef(0);
  const mounted = useRef(true);
  const requestId = useRef(0);
  const busy = useRef(false);
  const fetchRef = useRef(fetchPage);
  fetchRef.current = fetchPage;

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const load = useCallback(async (mode: 'load' | 'refresh' | 'more') => {
    if (busy.current && mode === 'more') return;
    busy.current = true;

    const id = ++requestId.current;
    const nextPage = mode === 'more' ? page.current + 1 : 0;

    if (mode === 'load') setLoading(true);
    if (mode === 'refresh') setRefreshing(true);
    if (mode === 'more') setLoadingMore(true);
    setError(undefined);

    try {
      const result = await fetchRef.current(nextPage);
      if (!mounted.current || id !== requestId.current) return;

      page.current = nextPage;
      setTotal(result.total);
      setHasMore(result.hasMore);
      setItems((previous) => {
        if (mode !== 'more') return result.items;
        const seen = new Set(previous.map((item) => item.id));
        return [...previous, ...result.items.filter((item) => !seen.has(item.id))];
      });
    } catch (caught) {
      if (!mounted.current || id !== requestId.current) return;
      setError(toUserMessage(caught));
    } finally {
      busy.current = false;
      if (mounted.current && id === requestId.current) {
        setLoading(false);
        setRefreshing(false);
        setLoadingMore(false);
      }
    }
  }, []);

  useEffect(() => {
    void load('load');
    // `deps` is the caller's dependency list; `load` is stable by construction.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return {
    items,
    total,
    loading,
    refreshing,
    loadingMore,
    error,
    hasMore,
    refresh: useCallback(() => load('refresh'), [load]),
    loadMore: useCallback(() => {
      if (hasMore && !loadingMore && !loading) void load('more');
    }, [hasMore, load, loading, loadingMore]),
    reload: useCallback(() => void load('load'), [load]),
    patchItem: useCallback((id: string, patch: Partial<T>) => {
      setItems((previous) => previous.map((item) => (item.id === id ? { ...item, ...patch } : item)));
    }, []),
    removeItem: useCallback((id: string) => {
      setItems((previous) => previous.filter((item) => item.id !== id));
      setTotal((previous) => Math.max(0, previous - 1));
    }, []),
  };
}
