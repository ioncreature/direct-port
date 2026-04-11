'use client';

import api from '@/lib/api';
import type { TnVedCode } from '@/lib/types';
import { useCallback, useEffect, useRef, useState } from 'react';

export function useTnVed() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<TnVedCode[]>([]);
  const [loading, setLoading] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const search = useCallback(async (q: string) => {
    abortRef.current?.abort();
    if (!q.trim()) {
      setResults([]);
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    abortRef.current = controller;
    setLoading(true);
    try {
      const { data } = await api.get<TnVedCode[]>('/tn-ved', {
        params: { search: q.trim() },
        signal: controller.signal,
      });
      setResults(data);
    } catch (err: unknown) {
      if (err instanceof Error && err.name !== 'CanceledError') setResults([]);
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => search(query), 300);
    return () => clearTimeout(timer);
  }, [query, search]);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  return { query, setQuery, results, loading };
}
