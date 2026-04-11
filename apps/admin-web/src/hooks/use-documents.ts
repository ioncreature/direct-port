'use client';

import api from '@/lib/api';
import type { Document, DocumentStatus, PaginatedResponse, SortOrder } from '@/lib/types';
import { useCallback, useEffect, useState } from 'react';

const PAGE_SIZE = 20;

export function useDocuments(options?: { telegramUserId?: string }) {
  const [documents, setDocuments] = useState<Document[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [sortBy, setSortBy] = useState('createdAt');
  const [sortOrder, setSortOrder] = useState<SortOrder>('DESC');
  const [status, setStatus] = useState<DocumentStatus | ''>('');

  const fetch = useCallback(async () => {
    setLoading(true);
    try {
      const params: Record<string, string | number> = { page, limit: PAGE_SIZE, sortBy, sortOrder };
      if (status) params.status = status;
      if (options?.telegramUserId) params.telegramUserId = options.telegramUserId;
      const { data } = await api.get<PaginatedResponse<Document>>('/documents', { params });
      setDocuments(data.data);
      setTotal(data.total);
    } finally {
      setLoading(false);
    }
  }, [page, sortBy, sortOrder, status, options?.telegramUserId]);

  useEffect(() => {
    fetch();
  }, [fetch]);

  const toggleSort = useCallback(
    (field: string) => {
      if (sortBy === field) {
        setSortOrder((prev) => (prev === 'DESC' ? 'ASC' : 'DESC'));
      } else {
        setSortBy(field);
        setSortOrder('DESC');
      }
      setPage(1);
    },
    [sortBy],
  );

  const filterByStatus = useCallback((s: DocumentStatus | '') => {
    setStatus(s);
    setPage(1);
  }, []);

  const downloadDocument = useCallback(async (id: string, fileName: string) => {
    const response = await api.get(`/documents/${id}/download`, { responseType: 'blob' });
    const url = window.URL.createObjectURL(new Blob([response.data]));
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', fileName);
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.URL.revokeObjectURL(url);
  }, []);

  return {
    documents,
    total,
    loading,
    page,
    limit: PAGE_SIZE,
    sortBy,
    sortOrder,
    status,
    setPage,
    toggleSort,
    filterByStatus,
    refetch: fetch,
    downloadDocument,
  };
}
