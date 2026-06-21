'use client';

import api from '@/lib/api';
import type { Lead, LeadSource, LeadStatus } from '@/lib/types';
import { useCallback, useMemo, useState } from 'react';
import { useServerPaginatedList } from './use-server-paginated-list';

export interface DiscoverPayload {
  query: string;
  city?: string;
  maxResults?: number;
}

export interface ImportItem {
  companyName: string;
  website?: string;
  inn?: string;
  city?: string;
}

export function useLeads() {
  const [status, setStatus] = useState<LeadStatus | ''>('');
  const [source, setSource] = useState<LeadSource | ''>('');
  const [minScore, setMinScore] = useState<number | ''>('');
  const [search, setSearch] = useState('');

  const extraParams = useMemo(
    () => ({
      status: status || undefined,
      source: source || undefined,
      minScore: minScore === '' ? undefined : minScore,
      search: search || undefined,
    }),
    [status, source, minScore, search],
  );

  const list = useServerPaginatedList<Lead>('/leads', { extraParams });

  const setStatusFilter = useCallback(
    (s: LeadStatus | '') => {
      setStatus(s);
      list.resetPage();
    },
    [list],
  );
  const setSourceFilter = useCallback(
    (s: LeadSource | '') => {
      setSource(s);
      list.resetPage();
    },
    [list],
  );
  const setMinScoreFilter = useCallback(
    (v: number | '') => {
      setMinScore(v);
      list.resetPage();
    },
    [list],
  );
  const setSearchFilter = useCallback(
    (v: string) => {
      setSearch(v);
      list.resetPage();
    },
    [list],
  );

  const discover = useCallback(async (payload: DiscoverPayload) => {
    await api.post('/leads/discover', payload);
  }, []);

  const importLeads = useCallback(
    async (items: ImportItem[], opts: { source?: LeadSource; autoEnrich?: boolean } = {}) => {
      const { data } = await api.post<{ created: number; skipped: number }>('/leads/import', {
        items,
        ...opts,
      });
      await list.refetch();
      return data;
    },
    [list],
  );

  return {
    leads: list.items,
    total: list.total,
    loading: list.loading,
    page: list.page,
    limit: list.limit,
    sortBy: list.sortBy,
    sortOrder: list.sortOrder,
    setPage: list.setPage,
    toggleSort: list.toggleSort,
    refetch: list.refetch,
    status,
    source,
    minScore,
    search,
    setStatusFilter,
    setSourceFilter,
    setMinScoreFilter,
    setSearchFilter,
    discover,
    importLeads,
  };
}
