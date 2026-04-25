'use client';

import api from '@/lib/api';
import { downloadDocument } from '@/lib/documents';
import type { Document, DocumentStatus } from '@/lib/types';
import { useCallback, useMemo, useState } from 'react';
import { useServerPaginatedList } from './use-server-paginated-list';

export function useDocuments(options?: { telegramUserId?: string }) {
  const [status, setStatus] = useState<DocumentStatus | ''>('');

  const extraParams = useMemo(
    () => ({
      status: status || undefined,
      telegramUserId: options?.telegramUserId,
    }),
    [status, options?.telegramUserId],
  );

  const list = useServerPaginatedList<Document>('/documents', { extraParams });

  const filterByStatus = useCallback(
    (s: DocumentStatus | '') => {
      setStatus(s);
      list.resetPage();
    },
    [list],
  );

  const reprocessDocument = useCallback(
    async (id: string) => {
      await api.post(`/documents/${id}/reprocess`);
      await list.refetch();
    },
    [list],
  );

  return {
    documents: list.items,
    total: list.total,
    loading: list.loading,
    page: list.page,
    limit: list.limit,
    sortBy: list.sortBy,
    sortOrder: list.sortOrder,
    status,
    setPage: list.setPage,
    toggleSort: list.toggleSort,
    filterByStatus,
    refetch: list.refetch,
    downloadDocument,
    reprocessDocument,
  };
}
