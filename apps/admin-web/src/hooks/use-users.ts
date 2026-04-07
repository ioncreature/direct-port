'use client';

import { useCallback, useEffect, useState } from 'react';
import api from '@/lib/api';
import type { User } from '@/lib/types';

export function useUsers() {
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);

  const fetch = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get<User[]>('/users');
      setUsers(data);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetch(); }, [fetch]);

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

  return { users, loading, refetch: fetch, createUser, updateUser, deleteUser };
}
