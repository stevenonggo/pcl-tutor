import { useFocusEffect } from 'expo-router';
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type DependencyList,
} from 'react';

import { ApiError } from '@/lib/api';

interface AsyncDataOptions {
  /** Refresh quietly when the screen regains focus (e.g. after a booking). */
  refreshOnFocus?: boolean;
}

interface AsyncDataState<T> {
  data: T | null;
  loading: boolean;
  refreshing: boolean;
  error: string | null;
  reload: () => Promise<void>;
  refresh: () => Promise<void>;
  setData: (value: T | null) => void;
}

function errorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    return error.message;
  }
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return 'Something went wrong. Please try again.';
}

/**
 * Small data-fetching hook used by every authenticated screen.
 *
 * `loading` is only true for the first load / dependency change; `refresh`
 * is the pull-to-refresh path. `refreshOnFocus` reloads quietly when the
 * screen becomes visible again so actions taken on another screen (booking,
 * confirming a request) show up immediately.
 */
export function useAsyncData<T>(
  loader: () => Promise<T>,
  deps: DependencyList = [],
  options: AsyncDataOptions = {},
): AsyncDataState<T> {
  const loaderRef = useRef(loader);
  loaderRef.current = loader;

  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const mountedRef = useRef(true);
  const runRef = useRef(0);

  const load = useCallback(async (mode: 'load' | 'refresh') => {
    const run = ++runRef.current;
    if (mode === 'load') {
      setLoading(true);
    } else {
      setRefreshing(true);
    }
    setError(null);
    try {
      const value = await loaderRef.current();
      if (mountedRef.current && run === runRef.current) {
        setData(value);
      }
    } catch (err) {
      if (mountedRef.current && run === runRef.current) {
        setError(errorMessage(err));
      }
    } finally {
      if (mountedRef.current && run === runRef.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    void load('load');
    return () => {
      mountedRef.current = false;
    };
    // The caller controls re-fetching through `deps`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  const firstFocusRef = useRef(true);
  useFocusEffect(
    useCallback(() => {
      if (firstFocusRef.current) {
        firstFocusRef.current = false;
        return;
      }
      if (options.refreshOnFocus) {
        void load('refresh');
      }
    }, [load, options.refreshOnFocus]),
  );

  const reload = useCallback(() => load('load'), [load]);
  const refresh = useCallback(() => load('refresh'), [load]);

  return { data, loading, refreshing, error, reload, refresh, setData };
}
