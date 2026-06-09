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

// Модульный кеш: одни ссылки на всю жизнь вкладки. Username бота меняется крайне редко
// (только при рестарте с другим токеном), а блок «Telegram-боты» рисуется на нескольких
// страницах — новый GET на каждый mount/навигацию был бы лишним.
const EMPTY: BotLinks = { client: null, manager: null };
let cache: BotLinks | null = null;
let pending: Promise<BotLinks> | null = null;

async function loadBotLinks(): Promise<BotLinks> {
  if (cache) return cache;
  if (!pending) {
    pending = api
      .get<BotLinks>('/bot-links')
      .then(({ data }) => {
        cache = data;
        return data;
      })
      .catch(() => {
        cache = EMPTY;
        return EMPTY;
      })
      .finally(() => {
        pending = null;
      });
  }
  return pending;
}

export function useBotLinks() {
  const [links, setLinks] = useState<BotLinks | null>(() => cache);
  const [loading, setLoading] = useState(() => cache === null);

  useEffect(() => {
    if (cache) return;
    let cancelled = false;
    loadBotLinks().then((data) => {
      if (!cancelled) {
        setLinks(data);
        setLoading(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return { links, loading };
}
