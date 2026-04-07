'use client';

import { useCallback, useState } from 'react';
import api from '@/lib/api';
import type { Document } from '@/lib/types';

export function useUploadDocument() {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const upload = useCallback(async (file: File): Promise<Document> => {
    setUploading(true);
    setError(null);
    try {
      const formData = new FormData();
      formData.append('file', file);
      const { data } = await api.post<Document>('/documents/upload-admin', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
        timeout: 120_000,
      });
      return data;
    } catch (err: unknown) {
      const msg =
        err instanceof Error ? err.message : 'Ошибка при загрузке файла';
      setError(msg);
      throw err;
    } finally {
      setUploading(false);
    }
  }, []);

  return { upload, uploading, error };
}
