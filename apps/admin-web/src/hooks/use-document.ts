'use client';

import api from '@/lib/api';
import type { Document, DocumentStatus, ParsedDataRow } from '@/lib/types';
import { useCallback, useEffect, useState } from 'react';

const IN_PROGRESS_STATUSES: DocumentStatus[] = ['parsing', 'pending', 'processing'];
const POLL_INTERVAL_MS = 3000;

export function useDocument(id: string) {
  const [document, setDocument] = useState<Document | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetch = useCallback(
    async (silent = false) => {
      if (!silent) {
        setLoading(true);
        setError(null);
      }
      try {
        const { data } = await api.get<Document>(`/documents/${id}`);
        setDocument((prev) =>
          prev && prev.updatedAt === data.updatedAt && prev.status === data.status ? prev : data,
        );
      } catch {
        if (!silent) setError('Не удалось загрузить документ');
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [id],
  );

  useEffect(() => {
    fetch();
  }, [fetch]);

  useEffect(() => {
    if (!document) return;
    if (!IN_PROGRESS_STATUSES.includes(document.status)) return;
    const interval = setInterval(() => {
      fetch(true);
    }, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [document?.status, fetch]);

  const reprocess = useCallback(async () => {
    try {
      await api.post(`/documents/${id}/reprocess`);
      await fetch();
    } catch {
      setError('Не удалось переобработать документ');
    }
  }, [id, fetch]);

  const saveParsedData = useCallback(
    async (parsedData: ParsedDataRow[], currency?: string) => {
      try {
        await api.patch(`/documents/${id}/review`, { parsedData, currency });
        await fetch();
      } catch {
        setError('Не удалось сохранить данные');
        throw new Error('save failed');
      }
    },
    [id, fetch],
  );

  const reject = useCallback(
    async (reason: string) => {
      try {
        await api.post(`/documents/${id}/reject`, { reason });
        await fetch();
      } catch {
        setError('Не удалось отклонить документ');
      }
    },
    [id, fetch],
  );

  return { document, loading, error, refetch: fetch, reprocess, saveParsedData, reject };
}
