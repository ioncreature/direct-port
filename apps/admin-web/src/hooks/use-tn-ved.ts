'use client';

import api from '@/lib/api';
import type { TnVedSearchResponse } from '@/lib/types';
import { useCallback, useEffect, useRef, useState } from 'react';

export function useTnVed() {
  const [query, setQuery] = useState('');
  const [result, setResult] = useState<TnVedSearchResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [debouncing, setDebouncing] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const search = useCallback(async (q: string) => {
    abortRef.current?.abort();
    setDebouncing(false);
    if (!q.trim()) {
      setResult(null);
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    abortRef.current = controller;
    setLoading(true);
    try {
      const { data } = await api.get<TnVedSearchResponse>('/tn-ved', {
        params: { search: q.trim() },
        signal: controller.signal,
      });
      setResult(data);
    } catch (err: unknown) {
      if (err instanceof Error && err.name !== 'CanceledError') setResult(null);
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, []);

  const searchImmediate = useCallback(
    (q: string) => {
      setQuery(q);
      search(q);
    },
    [search],
  );

  useEffect(() => {
    if (!query.trim()) {
      setDebouncing(false);
      setResult(null);
      return;
    }
    setDebouncing(true);
    const timer = setTimeout(() => search(query), 1500);
    return () => clearTimeout(timer);
  }, [query, search]);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  return { query, setQuery, result, loading, debouncing, searchImmediate };
}
