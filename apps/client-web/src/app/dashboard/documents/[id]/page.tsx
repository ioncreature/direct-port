'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import api from '@/lib/api';
import { getStoredProfile, isAuthenticated, logout } from '@/lib/auth';
import {
  calcStatusTone,
  CALC_STATUS_LABELS,
  fmtDateTime,
  fmtInt,
  fmtRub,
  isInProgress,
  statusTone,
} from '@/lib/format';
import type { CalculatedRow, ClientDocumentDetail } from '@/lib/types';

export default function DocumentDetailPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const id = params.id;
  const [doc, setDoc] = useState<ClientDocumentDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isAuthenticated()) {
      router.replace('/');
      return;
    }
    let active = true;
    const fetchDoc = async () => {
      try {
        const res = await api.get<ClientDocumentDetail>(`/client/documents/${id}`);
        if (active) {
          setDoc(res.data);
          setError(null);
        }
      } catch (err) {
        const status = (err as { response?: { status?: number } })?.response?.status;
        if (active) setError(status === 404 ? 'Документ не найден.' : 'Не удалось загрузить документ.');
      } finally {
        if (active) setLoading(false);
      }
    };
    void fetchDoc();
    return () => {
      active = false;
    };
  }, [id, router]);

  // Пока документ в работе — мягко поллим, чтобы построчный результат появился сам.
  // Зависим от булева inProgress, а не от всего doc: setDoc на каждый тик не пересоздаёт таймер.
  const inProgress = doc ? isInProgress(doc.status) : false;
  useEffect(() => {
    if (!inProgress) return;
    const timer = setInterval(async () => {
      try {
        const res = await api.get<ClientDocumentDetail>(`/client/documents/${id}`);
        setDoc(res.data);
      } catch {
        /* временная ошибка поллинга не критична — следующий тик повторит */
      }
    }, 5000);
    return () => clearInterval(timer);
  }, [inProgress, id]);

  const profile = getStoredProfile();
  const displayName = profile?.name || profile?.username || 'Клиент';
  const rows: CalculatedRow[] = doc?.resultData ?? [];
  const totalRub = rows.reduce((sum, r) => sum + (r.totalCostRub ?? 0), 0);

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
        <Link className="back-link" href="/dashboard">
          ← К документам
        </Link>

        {loading ? (
          <div className="loading">Загрузка…</div>
        ) : error || !doc ? (
          <div className="empty error-text">{error ?? 'Документ не найден.'}</div>
        ) : (
          <>
            <section className="section">
              <div className="section-head">
                <h2 className="section-title">{doc.originalFileName}</h2>
                <span className={`badge badge-${statusTone(doc.status)}`}>{doc.statusLabel}</span>
              </div>
              <div className="detail-meta">
                <div>
                  <span className="meta-label">Позиций</span>
                  <span className="meta-value">{fmtInt(doc.rowCount)}</span>
                </div>
                {doc.currency && (
                  <div>
                    <span className="meta-label">Валюта</span>
                    <span className="meta-value">{doc.currency}</span>
                  </div>
                )}
                {rows.length > 0 && (
                  <div>
                    <span className="meta-label">Итого</span>
                    <span className="meta-value">{fmtRub(totalRub)}</span>
                  </div>
                )}
                <div>
                  <span className="meta-label">Загружен</span>
                  <span className="meta-value">{fmtDateTime(doc.createdAt)}</span>
                </div>
              </div>

              {doc.errorMessage && (
                <p className="error-text" style={{ padding: '0 20px' }}>
                  {doc.errorMessage}
                </p>
              )}
              {doc.rejectionReasons && doc.rejectionReasons.length > 0 && (
                <ul className="notes-list" style={{ padding: '0 20px 12px' }}>
                  {doc.rejectionReasons.map((r, i) => (
                    <li key={i} className="note note-blocker">
                      {r}
                    </li>
                  ))}
                </ul>
              )}
              {rows.length === 0 && !doc.errorMessage && (
                <div className="empty">
                  {isInProgress(doc.status)
                    ? 'Документ обрабатывается — результат появится здесь автоматически.'
                    : 'Построчный результат пока недоступен.'}
                </div>
              )}
            </section>

            {rows.length > 0 && (
              <section className="section">
                <div className="section-head">
                  <h2 className="section-title">Расчёт по позициям</h2>
                </div>
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Наименование</th>
                        <th>Код ТН ВЭД</th>
                        <th className="num">Кол-во</th>
                        <th className="num">Пошлина</th>
                        <th className="num">НДС</th>
                        <th className="num">Итого</th>
                        <th>Статус</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((row, i) => (
                        <RowView key={i} row={row} />
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            )}
          </>
        )}
      </main>
    </>
  );
}

function RowView({ row }: { row: CalculatedRow }) {
  const notes = row.notes ?? [];
  return (
    <>
      <tr>
        <td className="strong">{row.description}</td>
        <td>{row.tnVedCode ?? '—'}</td>
        <td className="num">{fmtInt(row.quantity)}</td>
        <td className="num">{fmtRub(row.dutyAmountRub)}</td>
        <td className="num">{fmtRub(row.vatAmountRub)}</td>
        <td className="num">{fmtRub(row.totalCostRub)}</td>
        <td>
          <span className={`badge badge-${calcStatusTone(row.calculationStatus)}`}>
            {CALC_STATUS_LABELS[row.calculationStatus ?? ''] ?? row.calculationStatus ?? '—'}
          </span>
        </td>
      </tr>
      {notes.length > 0 && (
        <tr className="notes-row">
          <td colSpan={7}>
            <ul className="notes-list">
              {notes.map((n, i) => (
                <li key={i} className={`note note-${n.severity}`}>
                  {n.message}
                </li>
              ))}
            </ul>
          </td>
        </tr>
      )}
    </>
  );
}
