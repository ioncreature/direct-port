'use client';

import api from '@/lib/api';
import type { DashboardPeriod, DashboardStats } from '@/lib/types';
import { useEffect, useState } from 'react';

/**
 * Сводная статистика дашборда. Предыдущие данные не сбрасываются при смене
 * фильтров — страница показывает их полупрозрачными, пока грузятся новые
 * (тот же приём, что на /ai-costs).
 */
export function useDashboardStats(period: DashboardPeriod, companyId: string) {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api
      .get<DashboardStats>('/dashboard/stats', {
        params: { period, ...(companyId ? { companyId } : {}) },
      })
      .then(({ data }) => {
        if (!cancelled) setStats(data);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [period, companyId]);

  return { stats, loading };
}
