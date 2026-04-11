'use client';

import api from '@/lib/api';
import type { Document, ParsedDataRow } from '@/lib/types';
import { useCallback, useEffect, useState } from 'react';

export function useDocument(id: string) {
  const [document, setDocument] = useState<Document | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetch = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data } = await api.get<Document>(`/documents/${id}`);
      setDocument(data);
    } catch {
      setError('Не удалось загрузить документ');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    fetch();
  }, [fetch]);

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
