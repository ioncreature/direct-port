'use client';

import type { TelegramUser } from '@/lib/types';
import { useCallback, useMemo, useState } from 'react';
import { useServerPaginatedList } from './use-server-paginated-list';

export function useTelegramUsers() {
  const [companyId, setCompanyId] = useState('');

  const extraParams = useMemo(() => ({ companyId: companyId || undefined }), [companyId]);

  const list = useServerPaginatedList<TelegramUser>('/telegram-users', { extraParams });

  const filterByCompany = useCallback(
    (c: string) => {
      setCompanyId(c);
      list.resetPage();
    },
    [list],
  );

  return {
    telegramUsers: list.items,
    total: list.total,
    loading: list.loading,
    page: list.page,
    limit: list.limit,
    sortBy: list.sortBy,
    sortOrder: list.sortOrder,
    companyId,
    setPage: list.setPage,
    toggleSort: list.toggleSort,
    filterByCompany,
    refetch: list.refetch,
  };
}
