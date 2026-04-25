'use client';

import api from '@/lib/api';
import type { User } from '@/lib/types';
import { useCallback, useMemo, useState } from 'react';
import { useServerPaginatedList } from './use-server-paginated-list';

type RoleFilter = User['role'] | '';

export function useUsers() {
  const [role, setRole] = useState<RoleFilter>('');

  const extraParams = useMemo(() => ({ role: role || undefined }), [role]);

  const list = useServerPaginatedList<User>('/users', { extraParams });

  const filterByRole = useCallback(
    (r: RoleFilter) => {
      setRole(r);
      list.resetPage();
    },
    [list],
  );

  const createUser = useCallback(
    async (payload: { email: string; password: string; role: User['role'] }) => {
      await api.post('/users', payload);
      await list.refetch();
    },
    [list],
  );

  const updateUser = useCallback(
    async (
      id: string,
      payload: { email?: string; password?: string; role?: User['role']; isActive?: boolean },
    ) => {
      await api.patch(`/users/${id}`, payload);
      await list.refetch();
    },
    [list],
  );

  const deleteUser = useCallback(
    async (id: string) => {
      await api.delete(`/users/${id}`);
      await list.refetch();
    },
    [list],
  );

  return {
    users: list.items,
    total: list.total,
    loading: list.loading,
    page: list.page,
    limit: list.limit,
    sortBy: list.sortBy,
    sortOrder: list.sortOrder,
    role,
    setPage: list.setPage,
    toggleSort: list.toggleSort,
    filterByRole,
    refetch: list.refetch,
    createUser,
    updateUser,
    deleteUser,
  };
}
