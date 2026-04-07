'use client';

import { useCallback, useEffect, useState } from 'react';
import api from '@/lib/api';
import type { TelegramUser } from '@/lib/types';

export function useTelegramUsers() {
  const [telegramUsers, setTelegramUsers] = useState<TelegramUser[]>([]);
  const [loading, setLoading] = useState(true);

  const fetch = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get<TelegramUser[]>('/telegram-users');
      setTelegramUsers(data);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetch(); }, [fetch]);

  return { telegramUsers, loading, refetch: fetch };
}
