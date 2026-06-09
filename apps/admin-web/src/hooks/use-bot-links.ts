'use client';

import api from '@/lib/api';
import { useEffect, useState } from 'react';

export interface BotLink {
  username: string;
  url: string;
  updatedAt: string;
}

export interface BotLinks {
  client: BotLink | null;
  manager: BotLink | null;
}

export function useBotLinks() {
  const [links, setLinks] = useState<BotLinks | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .get<BotLinks>('/bot-links')
      .then(({ data }) => setLinks(data))
      .catch(() => setLinks(null))
      .finally(() => setLoading(false));
  }, []);

  return { links, loading };
}
