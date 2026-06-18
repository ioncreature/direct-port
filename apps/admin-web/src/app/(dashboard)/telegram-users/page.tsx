'use client';

import { BotLinksSection } from '@/components/bot-links-section';
import { CompanySelect } from '@/components/company-select';
import { Pager } from '@/components/pager';
import { SortableTh } from '@/components/sortable-th';
import { useAuth } from '@/hooks/use-auth';
import { useTelegramUsers } from '@/hooks/use-telegram-users';
import { fmtDate } from '@/lib/format';
import { btnOutline, tdEmpty, td, th } from '@/lib/table-styles';
import Link from 'next/link';

const sortableColumns: { field: string; label: string }[] = [
  { field: 'username', label: 'Username' },
  { field: 'createdAt', label: 'Дата регистрации' },
];

export default function TelegramUsersPage() {
  const { user } = useAuth();
  const isSuperAdmin = user?.role === 'super_admin';
  const {
    telegramUsers,
    total,
    loading,
    page,
    limit,
    sortBy,
    sortOrder,
    companyId,
    setPage,
    toggleSort,
    filterByCompany,
    refetch,
  } = useTelegramUsers();

  return (
    <div>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 16,
        }}
      >
        <h1>Telegram-пользователи</h1>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {isSuperAdmin && <CompanySelect value={companyId} onChange={filterByCompany} />}
          <button onClick={refetch} style={btnOutline}>
            Обновить
          </button>
        </div>
      </div>

      {loading ? (
        <p>Загрузка...</p>
      ) : (
        <>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={th}>Telegram ID</th>
                {sortableColumns.map((col) => (
                  <SortableTh
                    key={col.field}
                    field={col.field}
                    label={col.label}
                    sortBy={sortBy}
                    sortOrder={sortOrder}
                    onToggle={toggleSort}
                  />
                ))}
                <th style={th}>Имя</th>
                <th style={th}>Документов</th>
              </tr>
            </thead>
            <tbody>
              {telegramUsers.map((u) => (
                <tr key={u.id}>
                  <td style={td}>
                    <Link
                      href={`/telegram-users/${u.id}`}
                      style={{ color: 'var(--accent)', textDecoration: 'none' }}
                    >
                      {u.telegramId}
                    </Link>
                  </td>
                  <td style={td}>{u.username ? `@${u.username}` : '—'}</td>
                  <td style={td}>{fmtDate(u.createdAt)}</td>
                  <td style={td}>{[u.firstName, u.lastName].filter(Boolean).join(' ') || '—'}</td>
                  <td style={td}>{u.documentCount ?? 0}</td>
                </tr>
              ))}
              {telegramUsers.length === 0 && (
                <tr>
                  <td style={tdEmpty} colSpan={5}>
                    Telegram-пользователей пока нет
                  </td>
                </tr>
              )}
            </tbody>
          </table>

          <Pager page={page} total={total} limit={limit} onPageChange={setPage} />
        </>
      )}

      <BotLinksSection style={{ marginTop: 32 }} />
    </div>
  );
}
