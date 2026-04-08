'use client';

import { useCallback, useEffect, useState } from 'react';
import api from '@/lib/api';
import type { TelegramUser } from '@/lib/types';

export function useTelegramUser(id: string) {
  const [user, setUser] = useState<TelegramUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetch = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data } = await api.get<TelegramUser>(`/telegram-users/by-id/${id}`);
      setUser(data);
    } catch {
      setError('Не удалось загрузить пользователя');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { fetch(); }, [fetch]);

  return { user, loading, error };
}
