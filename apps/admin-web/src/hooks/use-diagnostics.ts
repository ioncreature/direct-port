'use client';

import api from '@/lib/api';
import type { DocumentVersionLite, PipelineStageRun } from '@/lib/types';
import { useCallback, useState } from 'react';

export interface DiagnosticsState {
  stageRuns: PipelineStageRun[] | null;
  versions: DocumentVersionLite[] | null;
  loading: boolean;
  error: string | null;
  load: () => Promise<void>;
}

export function useDiagnostics(id: string): DiagnosticsState {
  const [stageRuns, setStageRuns] = useState<PipelineStageRun[] | null>(null);
  const [versions, setVersions] = useState<DocumentVersionLite[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (stageRuns !== null && versions !== null) return;
    setLoading(true);
    setError(null);
    try {
      const [sr, vs] = await Promise.all([
        api.get<PipelineStageRun[]>(`/documents/${id}/stage-runs`),
        api.get<DocumentVersionLite[]>(`/documents/${id}/versions`),
      ]);
      setStageRuns(sr.data);
      setVersions(vs.data);
    } catch {
      setError('Не удалось загрузить диагностику');
    } finally {
      setLoading(false);
    }
  }, [id, stageRuns, versions]);

  return { stageRuns, versions, loading, error, load };
}
