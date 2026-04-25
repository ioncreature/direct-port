'use client';

import api from '@/lib/api';
import type { PaginatedResponse, SortOrder } from '@/lib/types';
import { useCallback, useEffect, useMemo, useState } from 'react';

export const DEFAULT_PAGE_SIZE = 20;

type ExtraParams = Record<string, string | number | undefined | null>;

export function useServerPaginatedList<T>(
  endpoint: string,
  opts: {
    defaultSortBy?: string;
    defaultSortOrder?: SortOrder;
    limit?: number;
    extraParams?: ExtraParams;
  } = {},
) {
  const limit = opts.limit ?? DEFAULT_PAGE_SIZE;
  const [items, setItems] = useState<T[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [sortBy, setSortBy] = useState(opts.defaultSortBy ?? 'createdAt');
  const [sortOrder, setSortOrder] = useState<SortOrder>(opts.defaultSortOrder ?? 'DESC');

  const extraKey = useMemo(() => JSON.stringify(opts.extraParams ?? {}), [opts.extraParams]);

  const fetch = useCallback(async () => {
    setLoading(true);
    try {
      const params: Record<string, string | number> = { page, limit, sortBy, sortOrder };
      const extras = JSON.parse(extraKey) as ExtraParams;
      for (const [k, v] of Object.entries(extras)) {
        if (v != null && v !== '') params[k] = v;
      }
      const { data } = await api.get<PaginatedResponse<T>>(endpoint, { params });
      setItems(data.data);
      setTotal(data.total);
    } finally {
      setLoading(false);
    }
  }, [endpoint, page, limit, sortBy, sortOrder, extraKey]);

  useEffect(() => {
    fetch();
  }, [fetch]);

  const toggleSort = useCallback(
    (field: string) => {
      if (sortBy === field) {
        setSortOrder((prev) => (prev === 'DESC' ? 'ASC' : 'DESC'));
      } else {
        setSortBy(field);
        setSortOrder('DESC');
      }
      setPage(1);
    },
    [sortBy],
  );

  const resetPage = useCallback(() => setPage(1), []);

  return {
    items,
    total,
    loading,
    page,
    limit,
    sortBy,
    sortOrder,
    setPage,
    toggleSort,
    refetch: fetch,
    resetPage,
  };
}
