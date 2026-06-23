'use client';

import { Pager } from '@/components/pager';
import { useClientDeposit } from '@/hooks/use-client-deposit';
import { fmtDateTimeLocale } from '@/lib/format';
import { btnPrimary, cardSurface, td, tdEmpty, th } from '@/lib/table-styles';
import type { DepositTransactionType } from '@/lib/types';
import Link from 'next/link';
import { useState } from 'react';

const typeLabels: Record<DepositTransactionType, string> = {
  topup: 'Пополнение',
  charge: 'Списание',
  adjustment: 'Корректировка',
};

const inputStyle: React.CSSProperties = {
  padding: '8px 10px',
  borderRadius: 'var(--radius-sm)',
  border: '1px solid var(--border)',
  background: 'var(--surface)',
  color: 'var(--text)',
  fontSize: 14,
};

/** Управление депозитом клиента: текущий баланс, ручное пополнение/корректировка, история. */
export function DepositPanel({
  clientId,
  balance,
  onChanged,
}: {
  clientId: string;
  balance: number;
  onChanged: () => void;
}) {
  const { transactions, total, page, limit, loading, submitting, error, setPage, adjust } =
    useClientDeposit(clientId);
  const [amount, setAmount] = useState('');
  const [comment, setComment] = useState('');

  const parsed = Number(amount);
  const valid = Number.isInteger(parsed) && parsed !== 0;

  const submit = async () => {
    if (!valid) return;
    const newBalance = await adjust(parsed, comment.trim() || undefined);
    if (newBalance !== null) {
      setAmount('');
      setComment('');
      onChanged();
    }
  };

  return (
    <div style={{ ...cardSurface, padding: 20 }}>
      <h2 style={{ margin: '0 0 4px', fontSize: 18 }}>Депозит</h2>
      <p style={{ margin: '0 0 16px', color: 'var(--text-muted)', fontSize: 13 }}>
        Баланс в обработанных позициях. 1 позиция списывается за каждую успешно посчитанную
        строку документа; обработка не запускается, если баланса не хватает.
      </p>

      <div style={{ fontSize: 30, fontWeight: 700, marginBottom: 18 }}>
        {balance}{' '}
        <span style={{ fontSize: 14, fontWeight: 500, color: 'var(--text-muted)' }}>поз.</span>
      </div>

      <div
        style={{
          display: 'flex',
          gap: 10,
          flexWrap: 'wrap',
          alignItems: 'flex-end',
          marginBottom: 6,
        }}
      >
        <label
          style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12, color: 'var(--text-muted)' }}
        >
          Количество (+ пополнить / − списать)
          <input
            type="number"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="напр. 20"
            style={{ ...inputStyle, width: 200 }}
          />
        </label>
        <label
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 4,
            fontSize: 12,
            color: 'var(--text-muted)',
            flex: 1,
            minWidth: 220,
          }}
        >
          Комментарий (необязательно)
          <input
            type="text"
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder="напр. оплата по счёту №..."
            style={inputStyle}
          />
        </label>
        <button
          onClick={submit}
          disabled={!valid || submitting}
          style={{
            ...btnPrimary,
            opacity: !valid || submitting ? 0.5 : 1,
            cursor: !valid || submitting ? 'not-allowed' : 'pointer',
          }}
        >
          {submitting ? 'Сохранение…' : 'Применить'}
        </button>
      </div>
      {error && <p style={{ color: 'var(--danger)', fontSize: 13, margin: '4px 0 0' }}>{error}</p>}

      <h3 style={{ margin: '22px 0 8px', fontSize: 14, color: 'var(--text-muted)' }}>
        История операций
      </h3>
      {loading ? (
        <p>Загрузка...</p>
      ) : (
        <>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={th}>Дата</th>
                <th style={th}>Тип</th>
                <th style={th}>Изменение</th>
                <th style={th}>Баланс после</th>
                <th style={th}>Комментарий</th>
                <th style={th}>Кто</th>
              </tr>
            </thead>
            <tbody>
              {transactions.map((t) => (
                <tr key={t.id}>
                  <td style={td}>{fmtDateTimeLocale(t.createdAt)}</td>
                  <td style={td}>{typeLabels[t.type] ?? t.type}</td>
                  <td
                    style={{
                      ...td,
                      color: t.delta >= 0 ? 'var(--success)' : 'var(--danger)',
                      fontWeight: 600,
                    }}
                  >
                    {t.delta >= 0 ? `+${t.delta}` : t.delta}
                  </td>
                  <td style={td}>{t.balanceAfter}</td>
                  <td style={td}>
                    {t.documentId ? (
                      <Link
                        href={`/documents/${t.documentId}`}
                        style={{ color: 'var(--accent)', textDecoration: 'none' }}
                      >
                        {t.comment ?? 'документ'}
                      </Link>
                    ) : (
                      (t.comment ?? '—')
                    )}
                  </td>
                  <td style={td}>{t.createdByEmail ?? 'система'}</td>
                </tr>
              ))}
              {transactions.length === 0 && (
                <tr>
                  <td style={tdEmpty} colSpan={6}>
                    Операций пока нет
                  </td>
                </tr>
              )}
            </tbody>
          </table>
          <Pager page={page} total={total} limit={limit} onPageChange={setPage} />
        </>
      )}
    </div>
  );
}
