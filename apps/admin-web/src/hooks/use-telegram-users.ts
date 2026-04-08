'use client';

import { useCallback, useEffect, useState } from 'react';
import api from '@/lib/api';
import type { TelegramUser, PaginatedResponse, SortOrder } from '@/lib/types';

const PAGE_SIZE = 20;

export function useTelegramUsers() {
  const [telegramUsers, setTelegramUsers] = useState<TelegramUser[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [sortBy, setSortBy] = useState('createdAt');
  const [sortOrder, setSortOrder] = useState<SortOrder>('DESC');

  const fetch = useCallback(async () => {
    setLoading(true);
    try {
      const params = { page, limit: PAGE_SIZE, sortBy, sortOrder };
      const { data } = await api.get<PaginatedResponse<TelegramUser>>('/telegram-users', { params });
      setTelegramUsers(data.data);
      setTotal(data.total);
    } finally {
      setLoading(false);
    }
  }, [page, sortBy, sortOrder]);

  useEffect(() => { fetch(); }, [fetch]);

  const toggleSort = useCallback((field: string) => {
    if (sortBy === field) {
      setSortOrder((prev) => (prev === 'DESC' ? 'ASC' : 'DESC'));
    } else {
      setSortBy(field);
      setSortOrder('DESC');
    }
    setPage(1);
  }, [sortBy]);

  return {
    telegramUsers, total, loading, page, limit: PAGE_SIZE, sortBy, sortOrder,
    setPage, toggleSort, refetch: fetch,
  };
}
