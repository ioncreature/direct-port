'use client';

import api from '@/lib/api';
import {
  calcAiCostFromMap,
  calcAiCostFromStages,
  fmtCost,
  fmtDateTime,
  fmtTokens,
  modelLabel,
  totalTokensFromStages,
} from '@/lib/format';
import { th, td, btnOutline } from '@/lib/table-styles';
import type { DailyTokenStats, TokenStats, TokenStatsPeriod } from '@/lib/types';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';

export default function AiCostsPage() {
  const [stats, setStats] = useState<TokenStats | null>(null);
  const [daily, setDaily] = useState<DailyTokenStats[]>([]);
  const [loading, setLoading] = useState(true);
  const [modelFilter, setModelFilter] = useState('');

  const fetchStats = useCallback((model: string) => {
    setLoading(true);
    const params: Record<string, string> = {};
    if (model) params.model = model;
    Promise.all([
      api.get<TokenStats>('/documents/token-stats', { params }),
      api.get<DailyTokenStats[]>('/documents/token-stats/daily', { params: { days: '30', ...(model ? { model } : {}) } }),
    ])
      .then(([statsRes, dailyRes]) => {
        setStats(statsRes.data);
        setDaily(dailyRes.data);
      })
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

      {daily.length > 0 && (
        <div style={{ marginBottom: 32, opacity: loading ? 0.5 : 1, transition: 'opacity 0.15s' }}>
          <h3 style={{ marginBottom: 12 }}>Расходы по дням</h3>
          <DailyChart data={daily} />
        </div>
      )}

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
                  const cost = calcAiCostFromMap(user.models);
                  const totalTokens = Object.values(user.models).reduce(
                    (s, u) => s + u.inputTokens + u.outputTokens, 0,
                  );
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
                  const cost = calcAiCostFromStages(doc.tokenUsage);
                  const totalTokens = totalTokensFromStages(doc.tokenUsage);
                  return (
                    <tr key={doc.id}>
                      <td style={td}>
                        <Link href={`/documents/${doc.id}`} style={{ textDecoration: 'none' }}>
                          <span style={{ display: 'inline-block', maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', verticalAlign: 'bottom' }}>
                            {doc.originalFileName}
                          </span>
                        </Link>
                        {doc.telegramUsername && (
                          <span style={{ color: '#888', fontSize: 12, marginLeft: 4 }}>@{doc.telegramUsername}</span>
                        )}
                      </td>
                      <td style={{ ...td, textAlign: 'right' }}>{fmtTokens(totalTokens)}</td>
                      <td style={{ ...td, textAlign: 'right', fontWeight: 600 }}>{fmtCost(cost)}</td>
                      <td style={{ ...td, fontSize: 13, color: '#666' }}>{fmtDateTime(doc.createdAt)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div style={{ marginTop: 24, padding: 16, background: '#f9f9f9', borderRadius: 8, fontSize: 13, color: '#888' }}>
        Расчёт стоимости по моделям: Claude Haiku — $1 / $5 за 1M токенов (in/out), Claude Sonnet — $3 / $15 за 1M токенов (in/out), Claude Opus — $5 / $25 за 1M токенов (in/out)
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
      <div style={{ fontSize: 13, color: '#888', marginTop: 8 }}>{period.documentCount} документов</div>
      {models.map(([model, usage]) => (
        <div key={model} style={{ fontSize: 12, color: '#aaa', marginTop: 4 }}>
          {modelLabel(model)}: {fmtTokens(usage.inputTokens)} in / {fmtTokens(usage.outputTokens)} out
        </div>
      ))}
    </div>
  );
}

const CHART_HEIGHT_PX = 120;

function DailyChart({ data }: { data: DailyTokenStats[] }) {
  const costs = data.map((d) => calcAiCostFromMap(d.models));
  const maxCost = Math.max(...costs, 0.01);
  const total = costs.reduce((s, c) => s + c, 0);
  const todayStr = new Date().toISOString().slice(0, 10);

  return (
    <div style={{ border: '1px solid #ddd', borderRadius: 8, padding: 20 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12, fontSize: 13, color: '#666' }}>
        <span>Последние {data.length} дней</span>
        <span style={{ fontWeight: 600 }}>Итого: {fmtCost(total)}</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height: CHART_HEIGHT_PX }}>
        {data.map((d, i) => {
          const cost = costs[i];
          // Высота в px: проценты от неопределённой высоты parent давали 0.
          const heightPx = cost > 0 ? Math.max((cost / maxCost) * CHART_HEIGHT_PX, 2) : 0;
          const isToday = d.date === todayStr;
          return (
            <div
              key={d.date}
              style={{ flex: 1, minWidth: 0, display: 'flex', justifyContent: 'center' }}
              title={`${d.date}: ${fmtCost(cost)}`}
            >
              <div
                style={{
                  width: '100%',
                  maxWidth: 24,
                  height: heightPx,
                  background: isToday ? '#2563eb' : '#93c5fd',
                  borderRadius: '3px 3px 0 0',
                  transition: 'height 0.3s',
                }}
              />
            </div>
          );
        })}
      </div>
      {data.length <= 14 ? (
        <div style={{ display: 'flex', gap: 2, marginTop: 4 }}>
          {data.map((d) => (
            <div
              key={d.date}
              style={{ flex: 1, minWidth: 0, fontSize: 10, color: '#999', textAlign: 'center', whiteSpace: 'nowrap' }}
            >
              {d.date.slice(5)}
            </div>
          ))}
        </div>
      ) : (
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: '#999', marginTop: 4 }}>
          <span>{data[0]?.date.slice(5)}</span>
          <span>{data[data.length - 1]?.date.slice(5)}</span>
        </div>
      )}
    </div>
  );
}
