'use client';

import { useCallback, useEffect, useState } from 'react';
import api from '@/lib/api';
import type { User, PaginatedResponse, SortOrder } from '@/lib/types';

const PAGE_SIZE = 20;

export function useUsers() {
  const [users, setUsers] = useState<User[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [sortBy, setSortBy] = useState('createdAt');
  const [sortOrder, setSortOrder] = useState<SortOrder>('DESC');
  const [role, setRole] = useState<'admin' | 'customs' | ''>('');

  const fetch = useCallback(async () => {
    setLoading(true);
    try {
      const params: Record<string, string | number> = { page, limit: PAGE_SIZE, sortBy, sortOrder };
      if (role) params.role = role;
      const { data } = await api.get<PaginatedResponse<User>>('/users', { params });
      setUsers(data.data);
      setTotal(data.total);
    } finally {
      setLoading(false);
    }
  }, [page, sortBy, sortOrder, role]);

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

  const filterByRole = useCallback((r: 'admin' | 'customs' | '') => {
    setRole(r);
    setPage(1);
  }, []);

  const createUser = useCallback(async (payload: { email: string; password: string; role: string }) => {
    await api.post('/users', payload);
    await fetch();
  }, [fetch]);

  const updateUser = useCallback(async (id: string, payload: { email?: string; password?: string; role?: string; isActive?: boolean }) => {
    await api.patch(`/users/${id}`, payload);
    await fetch();
  }, [fetch]);

  const deleteUser = useCallback(async (id: string) => {
    await api.delete(`/users/${id}`);
    await fetch();
  }, [fetch]);

  return {
    users, total, loading, page, limit: PAGE_SIZE, sortBy, sortOrder, role,
    setPage, toggleSort, filterByRole, refetch: fetch,
    createUser, updateUser, deleteUser,
  };
}
