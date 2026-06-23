'use client';

import { useServerPaginatedList } from '@/hooks/use-server-paginated-list';
import api from '@/lib/api';
import type { DepositTransaction } from '@/lib/types';
import { useCallback, useState } from 'react';

const LIMIT = 10;

/** Управление депозитом клиента: история операций (серверная пагинация) + ручное пополнение/корректировка. */
export function useClientDeposit(clientId: string) {
  const { items, total, page, limit, loading, setPage, refetch, resetPage } =
    useServerPaginatedList<DepositTransaction>(
      `/telegram-users/by-id/${clientId}/deposit-transactions`,
      { limit: LIMIT },
    );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /** Пополнение (amount > 0) или корректировка (amount < 0). Возвращает новый баланс или null. */
  const adjust = useCallback(
    async (amount: number, comment?: string): Promise<number | null> => {
      setSubmitting(true);
      setError(null);
      try {
        const { data } = await api.post<{ balance: number }>(
          `/telegram-users/by-id/${clientId}/deposit`,
          { amount, comment },
        );
        // Новая операция — самая свежая (страница 1). Если уже на ней — просто перезагрузим.
        if (page === 1) await refetch();
        else resetPage();
        return data.balance;
      } catch {
        setError('Не удалось изменить баланс');
        return null;
      } finally {
        setSubmitting(false);
      }
    },
    [clientId, page, refetch, resetPage],
  );

  return {
    transactions: items,
    total,
    page,
    limit,
    loading,
    submitting,
    error,
    setPage,
    adjust,
  };
}
