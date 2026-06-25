'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { TopUpSection } from '@/components/top-up-section';
import api from '@/lib/api';
import { getStoredProfile, isAuthenticated, logout } from '@/lib/auth';
import {
  fmtDateTime,
  fmtDelta,
  fmtInt,
  statusTone,
  TRANSACTION_LABELS,
} from '@/lib/format';
import type {
  ClientDocument,
  ClientMe,
  DepositTransaction,
  Paginated,
} from '@/lib/types';

export default function DashboardPage() {
  const router = useRouter();
  const [me, setMe] = useState<ClientMe | null>(null);
  const [documents, setDocuments] = useState<ClientDocument[]>([]);
  const [transactions, setTransactions] = useState<DepositTransaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState<string | null>(null);

  useEffect(() => {
    if (!isAuthenticated()) {
      router.replace('/');
      return;
    }
    (async () => {
      try {
        const [meRes, docsRes, txRes] = await Promise.all([
          api.get<ClientMe>('/client/me'),
          api.get<Paginated<ClientDocument>>('/client/documents', { params: { limit: 50 } }),
          api.get<Paginated<DepositTransaction>>('/client/transactions', {
            params: { limit: 50 },
          }),
        ]);
        setMe(meRes.data);
        setDocuments(docsRes.data.data);
        setTransactions(txRes.data.data);
      } catch {
        setError('Не удалось загрузить данные кабинета.');
      } finally {
        setLoading(false);
      }
    })();
  }, [router]);

  const download = useCallback(async (doc: ClientDocument) => {
    setDownloading(doc.id);
    try {
      const res = await api.get(`/client/documents/${doc.id}/download`, {
        responseType: 'blob',
      });
      const disposition = String(res.headers['content-disposition'] ?? '');
      const match = disposition.match(/filename\*?=(?:UTF-8'')?["']?([^"';]+)/i);
      const fileName = match ? decodeURIComponent(match[1]) : `${doc.originalFileName}.xlsx`;
      const url = URL.createObjectURL(res.data as Blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      alert('Не удалось скачать файл. Доступно только для обработанных документов.');
    } finally {
      setDownloading(null);
    }
  }, []);

  const profile = me ?? getStoredProfile();
  const displayName = profile?.name || profile?.username || 'Клиент';

  return (
    <>
      <header className="header">
        <div className="header-inner">
          <div className="logo">
            <span className="logo-mark">DP</span>
            <span>DirectPort</span>
          </div>
          <div className="header-user">
            {profile?.photoUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img className="avatar" src={profile.photoUrl} alt="" />
            )}
            <span>{displayName}</span>
            <button className="link-btn" onClick={logout}>
              Выйти
            </button>
          </div>
        </div>
      </header>

      <main className="main">
        {loading ? (
          <div className="loading">Загрузка…</div>
        ) : error ? (
          <div className="empty error-text">{error}</div>
        ) : (
          <>
            <div className="grid-cards">
              <div className="card">
                <p className="card-label">Баланс</p>
                <p className="card-value">{fmtInt(me?.balance ?? 0)}</p>
                <p className="card-sub">позиций для расчёта</p>
              </div>
              <div className="card">
                <p className="card-label">Документов</p>
                <p className="card-value">{fmtInt(documents.length)}</p>
                <p className="card-sub">всего загружено</p>
              </div>
            </div>

            <TopUpSection />

            <section className="section">
              <div className="section-head">
                <h2 className="section-title">Документы</h2>
              </div>
              {documents.length === 0 ? (
                <div className="empty">Пока нет документов.</div>
              ) : (
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Файл</th>
                        <th>Статус</th>
                        <th className="num">Позиций</th>
                        <th>Загружен</th>
                        <th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {documents.map((doc) => (
                        <tr key={doc.id}>
                          <td className="strong">{doc.originalFileName}</td>
                          <td>
                            <span className={`badge badge-${statusTone(doc.status)}`}>
                              {doc.statusLabel}
                            </span>
                          </td>
                          <td className="num">{fmtInt(doc.rowCount)}</td>
                          <td>{fmtDateTime(doc.createdAt)}</td>
                          <td className="num">
                            {doc.status === 'processed' && (
                              <button
                                className="btn"
                                disabled={downloading === doc.id}
                                onClick={() => download(doc)}
                              >
                                {downloading === doc.id ? 'Скачивание…' : 'Скачать Excel'}
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            <section className="section">
              <div className="section-head">
                <h2 className="section-title">История операций</h2>
              </div>
              {transactions.length === 0 ? (
                <div className="empty">Операций пока нет.</div>
              ) : (
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Дата</th>
                        <th>Операция</th>
                        <th>Комментарий</th>
                        <th className="num">Изменение</th>
                        <th className="num">Баланс</th>
                      </tr>
                    </thead>
                    <tbody>
                      {transactions.map((tx) => (
                        <tr key={tx.id}>
                          <td>{fmtDateTime(tx.createdAt)}</td>
                          <td className="strong">{TRANSACTION_LABELS[tx.type] ?? tx.type}</td>
                          <td>{tx.comment ?? '—'}</td>
                          <td className={`num ${tx.delta >= 0 ? 'delta-pos' : 'delta-neg'}`}>
                            {fmtDelta(tx.delta)}
                          </td>
                          <td className="num">{fmtInt(tx.balanceAfter)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </>
        )}
      </main>
    </>
  );
}
