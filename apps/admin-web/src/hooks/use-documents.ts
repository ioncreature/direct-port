'use client';

import { useCallback, useEffect, useState } from 'react';
import api from '@/lib/api';
import type { Document } from '@/lib/types';

export function useDocuments() {
  const [documents, setDocuments] = useState<Document[]>([]);
  const [loading, setLoading] = useState(true);

  const fetch = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get<Document[]>('/documents');
      setDocuments(data);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetch();
  }, [fetch]);

  const downloadDocument = useCallback(async (id: string, fileName: string) => {
    const response = await api.get(`/documents/${id}/download`, {
      responseType: 'blob',
    });
    const url = window.URL.createObjectURL(new Blob([response.data]));
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', fileName);
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.URL.revokeObjectURL(url);
  }, []);

  return { documents, loading, refetch: fetch, downloadDocument };
}
