'use client';

import api from '@/lib/api';
import type { RegulatoryExplanation } from '@/lib/types';
import { useEffect, useState } from 'react';

export type RegulatoryExplanationsState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready'; data: Record<string, RegulatoryExplanation> }
  | { status: 'error'; message: string };

/**
 * Lazy-load AI-выжимок разрешительных мер для конкретного кода ТН ВЭД.
 * Не блокирует основной показ /tn-ved страницы — запрос уходит после получения
 * детерминистического `regulatoryReport`. AbortController в cleanup гасит запрос
 * при смене кода или анмаунте — повторного запроса по тому же `code` не будет,
 * useEffect не пересоздастся, пока deps стабильны.
 */
export function useRegulatoryExplanations(
  code: string | null | undefined,
  enabled = true,
): RegulatoryExplanationsState {
  const [state, setState] = useState<RegulatoryExplanationsState>({ status: 'idle' });

  useEffect(() => {
    if (!enabled || !code) {
      setState({ status: 'idle' });
      return;
    }

    const controller = new AbortController();
    setState({ status: 'loading' });
    api
      .get<Record<string, RegulatoryExplanation>>(`/tn-ved/${code}/regulatory-explanations`, {
        signal: controller.signal,
      })
      .then(({ data }) => setState({ status: 'ready', data }))
      .catch((err: unknown) => {
        if (err instanceof Error && err.name === 'CanceledError') return;
        const message = err instanceof Error ? err.message : 'Не удалось загрузить AI-выжимки';
        setState({ status: 'error', message });
      });

    return () => controller.abort();
  }, [code, enabled]);

  return state;
}
