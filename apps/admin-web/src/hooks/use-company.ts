'use client';

import api from '@/lib/api';
import type { CompanyDetail } from '@/lib/types';
import { useCallback, useEffect, useState } from 'react';
import type { CompanyUpdatePayload } from './use-companies';

/** Деталь одной компании (со счётчиками) + мутации для её страницы (super_admin). */
export function useCompany(id: string) {
  const [company, setCompany] = useState<CompanyDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetch = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data } = await api.get<CompanyDetail>(`/companies/${id}`);
      setCompany(data);
    } catch {
      setError('Не удалось загрузить компанию');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    fetch();
  }, [fetch]);

  const update = useCallback(
    async (payload: CompanyUpdatePayload) => {
      await api.patch(`/companies/${id}`, payload);
      await fetch();
    },
    [id, fetch],
  );

  const remove = useCallback(async () => {
    await api.delete(`/companies/${id}`);
  }, [id]);

  return { company, loading, error, refetch: fetch, update, remove };
}
