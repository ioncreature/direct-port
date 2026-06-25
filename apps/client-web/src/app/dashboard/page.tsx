'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { TopUpSection } from '@/components/top-up-section';
import api from '@/lib/api';
import { getStoredProfile, isAuthenticated, logout } from '@/lib/auth';
import {
  fmtDateTime,
  fmtDelta,
  fmtInt,
  isInProgress,
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
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Профиль (баланс), документы и история обновляются одним заходом: после обработки
  // документа меняется и баланс, и список операций. initial=true рисует первый спиннер.
  const load = useCallback(async (initial = false) => {
    try {
      const [meRes, docsRes, txRes] = await Promise.all([
        api.get<ClientMe>('/client/me'),
        api.get<Paginated<ClientDocument>>('/client/documents', { params: { limit: 50 } }),
        api.get<Paginated<DepositTransaction>>('/client/transactions', { params: { limit: 50 } }),
      ]);
      setMe(meRes.data);
      setDocuments(docsRes.data.data);
      setTransactions(txRes.data.data);
      setError(null);
    } catch {
      if (initial) setError('Не удалось загрузить данные кабинета.');
    } finally {
      if (initial) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!isAuthenticated()) {
      router.replace('/');
      return;
    }
    void load(true);
  }, [router, load]);

  // Пока есть документы в работе (parsing/pending/processing), поллим статус — клиент
  // видит переход в PROCESSED и появление кнопки скачивания без перезагрузки страницы.
  // Зависим от булева флага, а не от массива documents: таймер не пересоздаётся на каждый
  // ответ поллинга (load() меняет ссылку documents), только при смене «есть/нет в работе».
  const hasInProgress = documents.some((d) => isInProgress(d.status));
  useEffect(() => {
    if (!hasInProgress) return;
    const timer = setInterval(() => void load(), 5000);
    return () => clearInterval(timer);
  }, [hasInProgress, load]);

  const handleFile = useCallback(
    async (file: File) => {
      setUploading(true);
      setUploadError(null);
      try {
        const form = new FormData();
        form.append('file', file);
        await api.post('/client/documents', form);
        await load();
      } catch (err) {
        const status = (err as { response?: { status?: number } })?.response?.status;
        setUploadError(
          status === 400
            ? 'Поддерживаются только файлы .xlsx и .csv (до 40 МБ).'
            : 'Не удалось загрузить файл. Попробуйте ещё раз.',
        );
      } finally {
        setUploading(false);
      }
    },
    [load],
  );

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
                <div className="section-actions">
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".xlsx,.csv"
                    hidden
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) void handleFile(f);
                      e.target.value = '';
                    }}
                  />
                  <button
                    className="btn btn-primary"
                    disabled={uploading}
                    onClick={() => fileInputRef.current?.click()}
                  >
                    {uploading ? 'Загрузка…' : 'Загрузить документ'}
                  </button>
                </div>
              </div>
              <p className="section-hint">
                Файл .xlsx или .csv со списком товаров. Расчёт запустится автоматически —
                спишется по позиции за каждую успешно посчитанную строку.
              </p>
              {uploadError && (
                <p className="error-text" style={{ padding: '0 20px' }}>
                  {uploadError}
                </p>
              )}
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
                          <td className="strong">
                            <Link className="doc-link" href={`/dashboard/documents/${doc.id}`}>
                              {doc.originalFileName}
                            </Link>
                          </td>
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
