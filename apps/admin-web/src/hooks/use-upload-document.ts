'use client';

import api from '@/lib/api';
import type { Document } from '@/lib/types';
import { useCallback, useState } from 'react';

const MAX_FILE_SIZE = 40 * 1024 * 1024; // 40 МБ — совпадает с лимитом API

export type UploadProgress = { loaded: number; total: number };

export function useUploadDocument() {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<UploadProgress | null>(null);

  const upload = useCallback(async (file: File): Promise<Document> => {
    setUploading(true);
    setError(null);
    setProgress({ loaded: 0, total: file.size });
    if (file.size > MAX_FILE_SIZE) {
      const sizeMb = (file.size / 1024 / 1024).toFixed(1);
      const err = `Файл слишком большой (${sizeMb} МБ). Максимальный размер — 40 МБ.`;
      setError(err);
      setUploading(false);
      setProgress(null);
      throw new Error(err);
    }
    try {
      const formData = new FormData();
      formData.append('file', file);
      const { data } = await api.post<Document>('/documents/upload-admin', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
        timeout: 120_000,
        onUploadProgress: (event) => {
          const total = event.total ?? file.size;
          setProgress({ loaded: event.loaded, total });
        },
      });
      return data;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Ошибка при загрузке файла';
      setError(msg);
      throw err;
    } finally {
      setUploading(false);
    }
  }, []);

  return { upload, uploading, error, progress };
}
