'use client';

import { useCallback, useEffect, useState } from 'react';
import api from '@/lib/api';
import {
  fmtDateTime,
  fmtInt,
  fmtMoney,
  TOP_UP_STATUS_LABELS,
  topUpStatusTone,
} from '@/lib/format';
import type { Paginated, TopUpPackage, TopUpRequest } from '@/lib/types';

const PAYMENT_DETAILS = process.env.NEXT_PUBLIC_PAYMENT_DETAILS || '';

/**
 * Пополнение баланса (Ф2): выбор пакета → заявка → реквизиты для offline-оплаты.
 * Зачисление происходит после подтверждения менеджером (баланс обновится при перезагрузке).
 */
export function TopUpSection() {
  const [packages, setPackages] = useState<TopUpPackage[]>([]);
  const [requests, setRequests] = useState<TopUpRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [cancelingId, setCancelingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showRequisites, setShowRequisites] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const [pkgRes, reqRes] = await Promise.all([
          api.get<TopUpPackage[]>('/client/packages'),
          api.get<Paginated<TopUpRequest>>('/client/topups', { params: { limit: 50 } }),
        ]);
        setPackages(pkgRes.data);
        setRequests(reqRes.data.data);
        if (reqRes.data.data.some((r) => r.status === 'pending')) setShowRequisites(true);
      } catch {
        setError('Не удалось загрузить данные пополнения.');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const create = useCallback(async (pkg: TopUpPackage) => {
    setBusyKey(pkg.key);
    setError(null);
    try {
      const { data } = await api.post<TopUpRequest>('/client/topups', { packageKey: pkg.key });
      setRequests((prev) => [data, ...prev]);
      setShowRequisites(true);
    } catch {
      setError('Не удалось создать заявку.');
    } finally {
      setBusyKey(null);
    }
  }, []);

  const cancel = useCallback(async (id: string) => {
    setCancelingId(id);
    setError(null);
    try {
      const { data } = await api.post<TopUpRequest>(`/client/topups/${id}/cancel`, {});
      setRequests((prev) => prev.map((r) => (r.id === id ? data : r)));
    } catch {
      setError('Не удалось отменить заявку.');
    } finally {
      setCancelingId(null);
    }
  }, []);

  return (
    <section className="section">
      <div className="section-head">
        <h2 className="section-title">Пополнить баланс</h2>
      </div>

      {loading ? (
        <div className="loading">Загрузка…</div>
      ) : (
        <div style={{ padding: 20 }}>
          {error && (
            <p className="error-text" style={{ marginTop: 0 }}>
              {error}
            </p>
          )}

          <div className="packages">
            {packages.map((pkg) => (
              <div className="package" key={pkg.key}>
                <p className="package-positions">{fmtInt(pkg.positions)} позиций</p>
                <p className="package-price">{fmtMoney(pkg.amount, pkg.currency)}</p>
                <p className="package-per">{fmtMoney(pkg.perPosition, pkg.currency)} / позиция</p>
                <button
                  className="btn btn-primary"
                  disabled={busyKey !== null}
                  onClick={() => create(pkg)}
                >
                  {busyKey === pkg.key ? 'Оформление…' : 'Оформить заявку'}
                </button>
              </div>
            ))}
          </div>

          {showRequisites && (
            <div className="requisites">
              <strong>Оплата по реквизитам</strong>
              <p>
                После оформления заявки оплатите её вне системы. Менеджер подтвердит
                поступление — позиции зачислятся на баланс.
              </p>
              {PAYMENT_DETAILS && <pre className="requisites-details">{PAYMENT_DETAILS}</pre>}
            </div>
          )}

          {requests.length > 0 && (
            <div className="table-wrap" style={{ marginTop: 20 }}>
              <table>
                <thead>
                  <tr>
                    <th>Дата</th>
                    <th className="num">Позиций</th>
                    <th className="num">Сумма</th>
                    <th>Статус</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {requests.map((r) => (
                    <tr key={r.id}>
                      <td>{fmtDateTime(r.createdAt)}</td>
                      <td className="num">{fmtInt(r.positions)}</td>
                      <td className="num">{fmtMoney(r.amount, r.currency)}</td>
                      <td>
                        <span className={`badge badge-${topUpStatusTone(r.status)}`}>
                          {TOP_UP_STATUS_LABELS[r.status]}
                        </span>
                      </td>
                      <td className="num">
                        {r.status === 'pending' && (
                          <button
                            className="link-btn"
                            disabled={cancelingId === r.id}
                            onClick={() => cancel(r.id)}
                          >
                            {cancelingId === r.id ? 'Отмена…' : 'Отменить'}
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
