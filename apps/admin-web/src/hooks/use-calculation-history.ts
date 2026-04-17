'use client';

import api from '@/lib/api';
import type { CalculationLog } from '@/lib/types';
import { useEffect, useState } from 'react';

export function useCalculationHistory(id: string, refreshKey: string | undefined) {
  const [history, setHistory] = useState<CalculationLog[]>([]);

  useEffect(() => {
    if (!id) return;
    api
      .get<CalculationLog[]>(`/documents/${id}/calculation-history`)
      .then(({ data }) => setHistory(data))
      .catch(() => setHistory([]));
  }, [id, refreshKey]);

  return history;
}
