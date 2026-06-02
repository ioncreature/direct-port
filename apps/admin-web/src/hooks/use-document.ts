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

  const isInProgress =
    !!document && IN_PROGRESS_STATUSES.includes(document.status);
  useEffect(() => {
    if (!isInProgress) return;
    const interval = setInterval(() => {
      fetch(true);
    }, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [isInProgress, fetch]);

  const reprocess = useCallback(async () => {
    try {
      await api.post(`/documents/${id}/reprocess`);
      await fetch();
    } catch {
      setError('Не удалось переобработать документ');
    }
  }, [id, fetch]);

  const recalculate = useCallback(
    async (params: {
      countryOfOrigin?: string;
      freightCost?: number;
      freightCurrency?: 'USD' | 'CNY' | 'RUB' | 'EUR';
    } = {}) => {
      try {
        const body: Record<string, unknown> = {};
        if (params.countryOfOrigin) body.countryOfOrigin = params.countryOfOrigin;
        if (params.freightCost !== undefined) body.freightCost = params.freightCost;
        if (params.freightCurrency !== undefined) body.freightCurrency = params.freightCurrency;
        await api.post(`/documents/${id}/recalculate`, body);
        await fetch();
      } catch {
        setError('Не удалось пересчитать документ');
        throw new Error('recalculate failed');
      }
    },
    [id, fetch],
  );

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
        const body = reason.trim() ? { reason } : {};
        await api.post(`/documents/${id}/reject`, body);
        await fetch();
      } catch {
        setError('Не удалось отклонить документ');
      }
    },
    [id, fetch],
  );

  const approve = useCallback(async () => {
    try {
      await api.post(`/documents/${id}/approve`);
      await fetch();
    } catch {
      setError('Не удалось принять документ');
    }
  }, [id, fetch]);

  const start = useCallback(async () => {
    try {
      await api.post(`/documents/${id}/start`);
      await fetch();
    } catch {
      setError('Не удалось запустить расчёт');
    }
  }, [id, fetch]);

  const setRowCode = useCallback(
    async (rowIndex: number, tnVedCode: string) => {
      try {
        await api.post(`/documents/${id}/rows/${rowIndex}/set-code`, { tnVedCode });
        await fetch();
      } catch (err) {
        const apiErr = err as { response?: { data?: { message?: string; code?: string } } };
        const msg = apiErr?.response?.data?.message;
        const code = apiErr?.response?.data?.code;
        if (code === 'UNKNOWN_TNVED_CODE') {
          setError(`Код ${tnVedCode} не найден в справочнике ТН ВЭД`);
        } else {
          setError(msg || 'Не удалось применить код к строке');
        }
        throw new Error('setRowCode failed');
      }
    },
    [id, fetch],
  );

  return { document, loading, error, refetch: fetch, reprocess, recalculate, saveParsedData, reject, approve, start, setRowCode };
}
