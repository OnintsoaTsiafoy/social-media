import { useCallback, useEffect, useRef, useState } from 'react';

import { toUserMessage } from '@/data/api';

export type AsyncState<T> = {
  data: T | undefined;
  /** True only for the first load - drives skeletons. */
  loading: boolean;
  /** True for pull-to-refresh - keeps the previous data on screen. */
  refreshing: boolean;
  error: string | undefined;
  reload: () => void;
  refresh: () => Promise<void>;
  setData: (updater: T | ((previous: T) => T)) => void;
};

/**
 * Runs an async read and exposes the loading / error / empty states every
 * connected screen has to handle. Stale results from a superseded call are
 * discarded, and nothing is written after unmount.
 */
export function useAsync<T>(run: () => Promise<T>, deps: React.DependencyList = []): AsyncState<T> {
  const [data, setDataState] = useState<T | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);

  const mounted = useRef(true);
  const callId = useRef(0);
  const runRef = useRef(run);
  runRef.current = run;

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const execute = useCallback(async (mode: 'load' | 'refresh') => {
    const id = ++callId.current;
    if (mode === 'load') setLoading(true);
    else setRefreshing(true);
    setError(undefined);

    try {
      const result = await runRef.current();
      if (!mounted.current || id !== callId.current) return;
      setDataState(result);
    } catch (caught) {
      if (!mounted.current || id !== callId.current) return;
      setError(toUserMessage(caught));
    } finally {
      if (mounted.current && id === callId.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, []);

  useEffect(() => {
    void execute('load');
    // `deps` is the caller's dependency list; `execute` is stable by construction.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  const setData = useCallback((updater: T | ((previous: T) => T)) => {
    setDataState((previous) =>
      typeof updater === 'function'
        ? (updater as (value: T) => T)(previous as T)
        : updater
    );
  }, []);

  return {
    data,
    loading,
    refreshing,
    error,
    reload: useCallback(() => void execute('load'), [execute]),
    refresh: useCallback(() => execute('refresh'), [execute]),
    setData,
  };
}

/**
 * Explicit outcome, so callers can tell success from failure even when the
 * action resolves to `void` - and so a dropped duplicate call is distinguishable.
 */
export type MutationResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string | undefined };

export type MutationState = {
  /** Disable the submit button while this is true - prevents double submits. */
  pending: boolean;
  error: string | undefined;
  run: <T>(action: () => Promise<T>) => Promise<MutationResult<T>>;
  clearError: () => void;
};

/**
 * Wraps a write. Guarantees a single in-flight call, so a double tap cannot
 * publish twice or send the same reply twice.
 */
export function useMutation(): MutationState {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const inFlight = useRef(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const run = useCallback(async <T,>(action: () => Promise<T>): Promise<MutationResult<T>> => {
    // A second tap while the first call is in flight is dropped, not queued.
    if (inFlight.current) return { ok: false, error: undefined };

    inFlight.current = true;
    setPending(true);
    setError(undefined);

    try {
      return { ok: true, data: await action() };
    } catch (caught) {
      const message = toUserMessage(caught);
      if (mounted.current) setError(message);
      return { ok: false, error: message };
    } finally {
      inFlight.current = false;
      if (mounted.current) setPending(false);
    }
  }, []);

  return { pending, error, run, clearError: useCallback(() => setError(undefined), []) };
}
