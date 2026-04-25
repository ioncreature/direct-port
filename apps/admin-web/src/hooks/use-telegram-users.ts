'use client';

import type { TelegramUser } from '@/lib/types';
import { useServerPaginatedList } from './use-server-paginated-list';

export function useTelegramUsers() {
  const list = useServerPaginatedList<TelegramUser>('/telegram-users');

  return {
    telegramUsers: list.items,
    total: list.total,
    loading: list.loading,
    page: list.page,
    limit: list.limit,
    sortBy: list.sortBy,
    sortOrder: list.sortOrder,
    setPage: list.setPage,
    toggleSort: list.toggleSort,
    refetch: list.refetch,
  };
}
