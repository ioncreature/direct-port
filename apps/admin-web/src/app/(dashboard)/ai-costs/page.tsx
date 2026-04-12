'use client';

import api from '@/lib/api';
import { calcAiCost, calcAiCostFromMap, fmtCost, fmtDateTime, fmtTokens, modelLabel, totalTokensFromMap } from '@/lib/format';
import { th, td, btnOutline } from '@/lib/table-styles';
import type { TokenStats, TokenStatsPeriod } from '@/lib/types';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';

export default function AiCostsPage() {
  const [stats, setStats] = useState<TokenStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [modelFilter, setModelFilter] = useState('');

  const fetchStats = useCallback((model: string) => {
    setLoading(true);
    const params: Record<string, string> = {};
    if (model) params.model = model;
    api
      .get<TokenStats>('/documents/token-stats', { params })
      .then(({ data }) => setStats(data))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    fetchStats(modelFilter);
  }, [fetchStats, modelFilter]);

  if (loading && !stats) return <p>Загрузка...</p>;
  if (!stats) return <p>Не удалось загрузить статистику</p>;

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 24 }}>
        <h1 style={{ margin: 0 }}>AI-расходы</h1>
        {stats.availableModels.length > 0 && (
          <div style={{ display: 'flex', gap: 6 }}>
            <button
              onClick={() => setModelFilter('')}
              style={{
                ...btnOutline,
                fontWeight: !modelFilter ? 700 : 400,
                borderColor: !modelFilter ? '#000' : '#ddd',
              }}
            >
              Все модели
            </button>
            {stats.availableModels.map((m) => (
              <button
                key={m}
                onClick={() => setModelFilter(m)}
                style={{
                  ...btnOutline,
                  fontWeight: modelFilter === m ? 700 : 400,
                  borderColor: modelFilter === m ? '#000' : '#ddd',
                }}
              >
                {modelLabel(m)}
              </button>
            ))}
          </div>
        )}
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
          gap: 16,
          marginBottom: 32,
          opacity: loading ? 0.5 : 1,
          transition: 'opacity 0.15s',
        }}
      >
        <PeriodCard label="Сегодня" period={stats.today} />
        <PeriodCard label="Неделя" period={stats.week} />
        <PeriodCard label="Месяц" period={stats.month} />
        <PeriodCard label="Всего" period={stats.total} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24, opacity: loading ? 0.5 : 1, transition: 'opacity 0.15s' }}>
        <div>
          <h3 style={{ marginBottom: 12 }}>Расходы по пользователям</h3>
          <div style={{ border: '1px solid #ddd', borderRadius: 8, overflow: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={th}>Пользователь</th>
                  <th style={{ ...th, textAlign: 'right' }}>Документы</th>
                  <th style={{ ...th, textAlign: 'right' }}>Токены</th>
                  <th style={{ ...th, textAlign: 'right' }}>Стоимость</th>
                </tr>
              </thead>
              <tbody>
                {stats.byUser.length === 0 && (
                  <tr>
                    <td colSpan={4} style={{ ...td, color: '#888', textAlign: 'center' }}>
                      Нет данных
                    </td>
                  </tr>
                )}
                {stats.byUser.map((user, i) => {
                  const cost = calcAiCost(user.inputTokens, user.outputTokens);
                  const totalTokens = user.inputTokens + user.outputTokens;
                  return (
                    <tr key={i}>
                      <td style={td}>
                        {user.username
                          ? `@${user.username}`
                          : user.firstName || user.telegramUserId || 'Админ'}
                      </td>
                      <td style={{ ...td, textAlign: 'right' }}>{user.documentCount}</td>
                      <td style={{ ...td, textAlign: 'right' }}>{fmtTokens(totalTokens)}</td>
                      <td style={{ ...td, textAlign: 'right', fontWeight: 600 }}>{fmtCost(cost)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        <div>
          <h3 style={{ marginBottom: 12 }}>Последние документы</h3>
          <div style={{ border: '1px solid #ddd', borderRadius: 8, overflow: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={th}>Документ</th>
                  <th style={{ ...th, textAlign: 'right' }}>Токены</th>
                  <th style={{ ...th, textAlign: 'right' }}>Стоимость</th>
                  <th style={th}>Дата</th>
                </tr>
              </thead>
              <tbody>
                {stats.recentDocuments.length === 0 && (
                  <tr>
                    <td colSpan={4} style={{ ...td, color: '#888', textAlign: 'center' }}>
                      Нет данных
                    </td>
                  </tr>
                )}
                {stats.recentDocuments.map((doc) => {
                  const cost = calcAiCostFromMap(doc.tokenUsage);
                  const totalTokens = totalTokensFromMap(doc.tokenUsage);
                  return (
                    <tr key={doc.id}>
                      <td style={td}>
                        <Link href={`/documents/${doc.id}`} style={{ textDecoration: 'none' }}>
                          <span
                            style={{
                              display: 'inline-block',
                              maxWidth: 180,
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                              verticalAlign: 'bottom',
                            }}
                          >
                            {doc.originalFileName}
                          </span>
                        </Link>
                        {doc.telegramUsername && (
                          <span style={{ color: '#888', fontSize: 12, marginLeft: 4 }}>
                            @{doc.telegramUsername}
                          </span>
                        )}
                      </td>
                      <td style={{ ...td, textAlign: 'right' }}>{fmtTokens(totalTokens)}</td>
                      <td style={{ ...td, textAlign: 'right', fontWeight: 600 }}>{fmtCost(cost)}</td>
                      <td style={{ ...td, fontSize: 13, color: '#666' }}>
                        {fmtDateTime(doc.createdAt)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div style={{ marginTop: 24, padding: 16, background: '#f9f9f9', borderRadius: 8, fontSize: 13, color: '#888' }}>
        Расчёт стоимости по моделям: Sonnet — $3 / $15 за 1M токенов (in/out), Haiku — $0.80 / $4 за 1M токенов (in/out)
      </div>
    </div>
  );
}

function PeriodCard({ label, period }: { label: string; period: TokenStatsPeriod }) {
  const cost = calcAiCostFromMap(period.models);
  const models = Object.entries(period.models);

  return (
    <div style={{ border: '1px solid #ddd', borderRadius: 8, padding: 20 }}>
      <div style={{ fontSize: 13, color: '#666', marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 28, fontWeight: 700 }}>{fmtCost(cost)}</div>
      <div style={{ fontSize: 13, color: '#888', marginTop: 8 }}>
        {period.documentCount} документов
      </div>
      {models.map(([model, usage]) => (
        <div key={model} style={{ fontSize: 12, color: '#aaa', marginTop: 4 }}>
          {modelLabel(model)}: {fmtTokens(usage.inputTokens)} in / {fmtTokens(usage.outputTokens)} out
        </div>
      ))}
    </div>
  );
}
