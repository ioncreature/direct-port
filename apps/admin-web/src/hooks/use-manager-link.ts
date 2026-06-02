'use client';

import api from '@/lib/api';
import { useState } from 'react';

export function useManagerLink(userId: string) {
  const [token, setToken] = useState<{ token: string; deepLink: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const createToken = async () => {
    setLoading(true);
    setError(null);
    try {
      const { data } = await api.post<{ token: string; deepLink: string }>(
        `/managers/${userId}/telegram-link-token`,
      );
      setToken(data);
    } catch {
      setError('Не удалось создать ссылку привязки');
    } finally {
      setLoading(false);
    }
  };

  const unlink = async () => {
    setLoading(true);
    setError(null);
    try {
      await api.delete(`/managers/${userId}/telegram-link`);
    } catch {
      setError('Не удалось отвязать Telegram');
      throw new Error('unlink failed');
    } finally {
      setLoading(false);
    }
  };

  return { token, loading, error, createToken, unlink };
}
