'use client';

import api from '@/lib/api';
import { useCallback, useEffect, useState } from 'react';

export const AI_MODEL_TIERS = ['opus', 'sonnet', 'haiku'] as const;
export type AiModelTier = (typeof AI_MODEL_TIERS)[number];

export interface AiConfig {
  id: number;
  parserModel: AiModelTier;
  queryFormulationModel: AiModelTier;
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
    async (values: Partial<Pick<AiConfig, 'parserModel' | 'queryFormulationModel' | 'classifierModel' | 'interpreterModel'>>) => {
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
