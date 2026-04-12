'use client';

import api from '@/lib/api';
import { useCallback, useEffect, useState } from 'react';

export type AiModelTier = 'opus' | 'sonnet' | 'haiku';

export interface AiConfig {
  id: number;
  parserModel: AiModelTier;
  classifierModel: AiModelTier;
  interpreterModel: AiModelTier;
  updatedAt: string;
}

export function useAiConfig() {
  const [config, setConfig] = useState<AiConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetch = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data } = await api.get<AiConfig>('/ai-config');
      setConfig(data);
    } catch {
      setError('Не удалось загрузить конфигурацию AI');
    } finally {
      setLoading(false);
    }
  }, []);

  const save = useCallback(
    async (values: Partial<Pick<AiConfig, 'parserModel' | 'classifierModel' | 'interpreterModel'>>) => {
      setSaving(true);
      setError(null);
      try {
        const { data } = await api.put<AiConfig>('/ai-config', values);
        setConfig(data);
      } catch {
        setError('Не удалось сохранить конфигурацию AI');
      } finally {
        setSaving(false);
      }
    },
    [],
  );

  useEffect(() => {
    fetch();
  }, [fetch]);

  return { config, loading, saving, error, save, refetch: fetch };
}
