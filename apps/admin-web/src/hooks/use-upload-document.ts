'use client';

import api from '@/lib/api';
import type { Document } from '@/lib/types';
import { useCallback, useState } from 'react';

const MAX_FILE_SIZE = 15 * 1024 * 1024; // 15 МБ — совпадает с лимитом API

export function useUploadDocument() {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const upload = useCallback(async (file: File): Promise<Document> => {
    setUploading(true);
    setError(null);
    if (file.size > MAX_FILE_SIZE) {
      const sizeMb = (file.size / 1024 / 1024).toFixed(1);
      const err = `Файл слишком большой (${sizeMb} МБ). Максимальный размер — 15 МБ.`;
      setError(err);
      setUploading(false);
      throw new Error(err);
    }
    try {
      const formData = new FormData();
      formData.append('file', file);
      const { data } = await api.post<Document>('/documents/upload-admin', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
        timeout: 120_000,
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

  return { upload, uploading, error };
}
