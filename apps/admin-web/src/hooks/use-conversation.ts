'use client';

import api from '@/lib/api';
import type { ConversationMessage } from '@/lib/types';
import { useCallback, useEffect, useState } from 'react';

export function useConversation(clientId: string) {
  const [messages, setMessages] = useState<ConversationMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetch = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data } = await api.get<ConversationMessage[]>(
        `/telegram-users/by-id/${clientId}/messages`,
      );
      setMessages(data);
    } catch {
      setError('Не удалось загрузить переписку');
    } finally {
      setLoading(false);
    }
  }, [clientId]);

  useEffect(() => {
    fetch();
  }, [fetch]);

  return { messages, loading, error, refetch: fetch };
}
