'use client';

import api from '@/lib/api';
import type { Company, CompanyTheme } from '@/lib/types';
import { useCallback } from 'react';
import { useServerPaginatedList } from './use-server-paginated-list';

export interface CompanyUpdatePayload {
  name?: string;
  slug?: string;
  theme?: CompanyTheme;
  domains?: string[];
}

export function useCompanies() {
  const list = useServerPaginatedList<Company>('/companies', {
    defaultSortBy: 'name',
    defaultSortOrder: 'ASC',
  });

  const createCompany = useCallback(
    async (payload: { name: string; slug?: string }) => {
      await api.post('/companies', payload);
      await list.refetch();
    },
    [list],
  );

  const updateCompany = useCallback(
    async (id: string, payload: CompanyUpdatePayload) => {
      await api.patch(`/companies/${id}`, payload);
      await list.refetch();
    },
    [list],
  );

  const deleteCompany = useCallback(
    async (id: string) => {
      await api.delete(`/companies/${id}`);
      await list.refetch();
    },
    [list],
  );

  return {
    companies: list.items,
    total: list.total,
    loading: list.loading,
    page: list.page,
    limit: list.limit,
    sortBy: list.sortBy,
    sortOrder: list.sortOrder,
    setPage: list.setPage,
    toggleSort: list.toggleSort,
    refetch: list.refetch,
    createCompany,
    updateCompany,
    deleteCompany,
  };
}
