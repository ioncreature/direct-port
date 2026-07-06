'use client';

import api from '@/lib/api';
import { useEffect, useState } from 'react';

export interface BotLink {
  username: string;
  url: string;
  /** true — собственный бот компании; false — общий платформенный (env-дефолт). */
  own: boolean;
  updatedAt?: string;
}

export interface BotLinks {
  client: BotLink | null;
  manager: BotLink | null;
}

// Кеш по компании: username бота меняется крайне редко, но зависит от выбранной компании
// (super_admin переключает на дашборде), поэтому ключуем по companyId ('' — общие/платформенные
// боты). Для admin/customs companyId не передаётся — бэкенд сам скоупит по их компании.
const EMPTY: BotLinks = { client: null, manager: null };
const cache = new Map<string, BotLinks>();
const pending = new Map<string, Promise<BotLinks>>();

async function loadBotLinks(companyId: string): Promise<BotLinks> {
  const cached = cache.get(companyId);
  if (cached) return cached;
  let p = pending.get(companyId);
  if (!p) {
    p = api
      .get<BotLinks>('/bot-links', companyId ? { params: { companyId } } : undefined)
      .then(({ data }) => {
        cache.set(companyId, data);
        return data;
      })
      .catch(() => {
        cache.set(companyId, EMPTY);
        return EMPTY;
      })
      .finally(() => {
        pending.delete(companyId);
      });
    pending.set(companyId, p);
  }
  return p;
}

export function useBotLinks(companyId?: string) {
  const key = companyId || '';
  const [links, setLinks] = useState<BotLinks | null>(() => cache.get(key) ?? null);
  const [loading, setLoading] = useState(() => !cache.has(key));

  useEffect(() => {
    const k = companyId || '';
    const cached = cache.get(k);
    if (cached) {
      setLinks(cached);
      setLoading(false);
      return;
    }
    setLoading(true);
    let cancelled = false;
    loadBotLinks(k).then((data) => {
      if (!cancelled) {
        setLinks(data);
        setLoading(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [companyId]);

  return { links, loading };
}
