'use client';

import api from '@/lib/api';
import type { RegulatoryExplanation } from '@/lib/types';
import { useEffect, useState } from 'react';
import type { RegulatoryExplanationsState } from './use-regulatory-explanations';

/**
 * Lazy-load AI-выжимок для всего документа одним запросом. Триггерится только когда
 * `enabled=true` (например, пользователь раскрыл первую строку с разрешительными
 * документами). Дальше состояние остаётся в памяти страницы — другие раскрытые
 * строки обращаются к этим же данным.
 */
export function useDocumentRegulatoryExplanations(
  documentId: string | null | undefined,
  enabled: boolean,
): RegulatoryExplanationsState {
  const [state, setState] = useState<RegulatoryExplanationsState>({ status: 'idle' });

  useEffect(() => {
    if (!enabled || !documentId) {
      setState({ status: 'idle' });
      return;
    }

    const controller = new AbortController();
    setState({ status: 'loading' });
    api
      .get<Record<string, RegulatoryExplanation>>(`/documents/${documentId}/regulatory-explanations`, {
        signal: controller.signal,
      })
      .then(({ data }) => setState({ status: 'ready', data }))
      .catch((err: unknown) => {
        if (err instanceof Error && err.name === 'CanceledError') return;
        const message = err instanceof Error ? err.message : 'Не удалось загрузить AI-выжимки';
        setState({ status: 'error', message });
      });

    return () => controller.abort();
  }, [documentId, enabled]);

  return state;
}
