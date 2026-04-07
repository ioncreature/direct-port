'use client';

import { useState, useEffect, useCallback } from 'react';
import api from '@/lib/api';

export interface CalculationConfig {
  id: number;
  pricePercent: number;
  weightRate: number;
  fixedFee: number;
  updatedAt: string;
}

export function useCalculationConfig() {
  const [config, setConfig] = useState<CalculationConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetch = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data } = await api.get<CalculationConfig>('/calculation-config');
      setConfig(data);
    } catch {
      setError('Не удалось загрузить конфигурацию');
    } finally {
      setLoading(false);
    }
  }, []);

  const save = useCallback(async (values: Partial<Pick<CalculationConfig, 'pricePercent' | 'weightRate' | 'fixedFee'>>) => {
    setSaving(true);
    setError(null);
    try {
      const { data } = await api.put<CalculationConfig>('/calculation-config', values);
      setConfig(data);
    } catch {
      setError('Не удалось сохранить конфигурацию');
    } finally {
      setSaving(false);
    }
  }, []);

  useEffect(() => { fetch(); }, [fetch]);

  return { config, loading, saving, error, save, refetch: fetch };
}
