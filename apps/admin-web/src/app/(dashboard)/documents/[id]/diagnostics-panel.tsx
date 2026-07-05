'use client';

import { ModelBreakdown } from '@/components/model-breakdown';
import { useDiagnostics } from '@/hooks/use-diagnostics';
import api from '@/lib/api';
import {
  calcAiCostFromMap,
  calcAiCostFromStages,
  fmt,
  fmtCost,
  fmtDateTime,
  fmtDuration,
  fmtTokens,
  modelLabel,
  stageLabel,
  totalTokensFromMap,
} from '@/lib/format';
import { btnLink, btnOutline, cardSurface, td, th } from '@/lib/table-styles';
import type {
  AiCall,
  AiCallLite,
  AiCallPurpose,
  DocumentVersion,
  DocumentVersionActorType,
  DocumentVersionLite,
  DocumentVersionReason,
  ParsedDataRow,
  PipelineStage,
  PipelineStageRun,
  PipelineStageStatus,
  TokenUsageByStage,
} from '@/lib/types';
import { useEffect, useMemo, useState } from 'react';

const STAGE_LABELS: Record<PipelineStage, string> = {
  parse: 'Парсинг',
  classify: 'Классификация',
  interpret: 'Интерпретация пошлин',
  calculate: 'Расчёт',
};

const STATUS_CONFIG: Record<
  PipelineStageStatus,
  { label: string; color: string; bg: string }
> = {
  ok: { label: 'Успех', color: 'var(--success)', bg: 'var(--success-soft)' },
  partial_ok: { label: 'Частично (fallback)', color: 'var(--orange-strong)', bg: 'var(--orange-soft-border)' },
  failed: { label: 'Ошибка', color: 'var(--danger)', bg: 'var(--danger-soft)' },
  running: { label: 'Выполняется', color: 'var(--accent)', bg: 'var(--accent-soft)' },
};

const PURPOSE_LABELS: Record<AiCallPurpose, string> = {
  parse_structure: 'Структура таблицы',
  parse_products: 'Извлечение товаров',
  parse_chunk: 'Чанк товаров',
  parse_validate: 'Валидация парсинга',
  classify_formulate_queries: 'Запросы TKS',
  classify: 'Классификация+верификация',
  classify_retry: 'Повторная классификация',
  classify_vision: 'Уточнение по фото',
  interpret: 'Интерпретация пошлин',
  translate_query: 'Перевод запроса',
  regulatory_interpret: 'Выжимка разрешит. мер',
};

const REASON_LABELS: Record<DocumentVersionReason, string> = {
  ai_parse: 'AI-парсинг',
  manual_edit: 'Ручная правка',
  reprocess: 'Переобработка',
};

const ACTOR_LABELS: Record<DocumentVersionActorType, string> = {
  system: 'Система',
  user: 'Пользователь',
  telegram: 'Telegram',
};

export function DiagnosticsPanel({
  documentId,
  tokenUsage,
}: {
  documentId: string;
  tokenUsage?: TokenUsageByStage | null;
}) {
  const { stageRuns, versions, loading, error, load } = useDiagnostics(documentId);
  const [selectedAiCallId, setSelectedAiCallId] = useState<string | null>(null);
  const [selectedVersion, setSelectedVersion] = useState<number | null>(null);

  useEffect(() => {
    load();
  }, [load]);

  if (loading && stageRuns === null) {
    return <div style={{ color: 'var(--text-muted)', padding: 16 }}>Загрузка диагностики…</div>;
  }
  if (error) {
    return (
      <div style={{ padding: 16 }}>
        <div style={{ color: 'var(--danger)', marginBottom: 8 }}>{error}</div>
        <button type="button" style={btnOutline} onClick={load}>
          Повторить
        </button>
      </div>
    );
  }

  return (
    <div>
      {tokenUsage && Object.keys(tokenUsage).length > 0 && (
        <section style={{ marginBottom: 32 }}>
          <div style={{ ...cardSurface, padding: 16 }}>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: 12,
              }}
            >
              <h3 style={{ margin: 0 }}>AI-расходы</h3>
              <span style={{ fontSize: 20, fontWeight: 650 }}>
                {fmtCost(calcAiCostFromStages(tokenUsage))}
              </span>
            </div>
            <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
              {Object.entries(tokenUsage).map(([stage, models]) => (
                <div
                  key={stage}
                  style={{ flex: '1 1 180px', padding: 12, background: 'var(--bg-subtle)', borderRadius: 6 }}
                >
                  <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>{stageLabel(stage)}</div>
                  <div style={{ fontSize: 15, fontWeight: 700 }}>{fmtCost(calcAiCostFromMap(models))}</div>
                  <ModelBreakdown models={models} />
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      <section style={{ marginBottom: 32 }}>
        <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 12 }}>Этапы обработки</h2>
        {stageRuns && stageRuns.length > 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {stageRuns.map((sr) => (
              <StageRunCard
                key={sr.id}
                stageRun={sr}
                onAiCallClick={setSelectedAiCallId}
              />
            ))}
          </div>
        ) : (
          <div style={{ color: 'var(--text-muted)' }}>Этапы ещё не зафиксированы.</div>
        )}
      </section>

      <section>
        <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 12 }}>
          Версии распознанных данных
        </h2>
        <VersionsTable versions={versions ?? []} onSelect={setSelectedVersion} />
      </section>

      {selectedAiCallId && (
        <AiCallModal
          documentId={documentId}
          callId={selectedAiCallId}
          onClose={() => setSelectedAiCallId(null)}
        />
      )}
      {selectedVersion !== null && (
        <VersionModal
          documentId={documentId}
          version={selectedVersion}
          onClose={() => setSelectedVersion(null)}
        />
      )}
    </div>
  );
}

function StageRunCard({
  stageRun,
  onAiCallClick,
}: {
  stageRun: PipelineStageRun;
  onAiCallClick: (callId: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const status = STATUS_CONFIG[stageRun.status];
  const cost = useMemo(() => calcAiCostFromMap(stageRun.tokenUsage), [stageRun.tokenUsage]);
  const totalTokens = useMemo(
    () => totalTokensFromMap(stageRun.tokenUsage),
    [stageRun.tokenUsage],
  );

  return (
    <div
      style={{
        border: '1px solid var(--border)',
        borderRadius: 8,
        background: '#fff',
        padding: '14px 16px',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ fontWeight: 600, fontSize: 15 }}>{STAGE_LABELS[stageRun.stage]}</div>
        <span
          style={{
            padding: '2px 8px',
            borderRadius: 4,
            background: status.bg,
            color: status.color,
            fontSize: 12,
            fontWeight: 500,
          }}
        >
          {status.label}
        </span>
        {stageRun.attempt > 1 && (
          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>попытка {stageRun.attempt}</span>
        )}
        <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
          {fmtDuration(stageRun.durationMs)}
        </span>
        {totalTokens > 0 && (
          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
            {fmtTokens(totalTokens)} токенов · {fmtCost(cost)}
          </span>
        )}
        <div style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--text-subtle)' }}>
          {fmtDateTime(stageRun.startedAt)}
          {stageRun.finishedAt ? ` → ${fmtDateTime(stageRun.finishedAt)}` : ''}
        </div>
      </div>

      {stageRun.error && (
        <div
          style={{
            marginTop: 10,
            padding: 10,
            background: 'var(--danger-soft)',
            border: '1px solid var(--danger-soft-border)',
            borderRadius: 6,
            fontSize: 12,
          }}
        >
          <div style={{ fontWeight: 600, color: 'var(--danger-strong)', marginBottom: 4 }}>
            {stageRun.error.message}
          </div>
          {stageRun.error.stack && (
            <details>
              <summary style={{ cursor: 'pointer', color: 'var(--text-muted)' }}>stack</summary>
              <pre
                style={{
                  marginTop: 6,
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                  fontSize: 11,
                  color: 'var(--danger-strong)',
                }}
              >
                {stageRun.error.stack}
              </pre>
            </details>
          )}
        </div>
      )}

      {stageRun.aiCalls.length > 0 && (
        <div style={{ marginTop: 10 }}>
          <button
            type="button"
            style={{ ...btnLink, color: 'var(--accent)', fontSize: 13 }}
            onClick={() => setExpanded((v) => !v)}
          >
            {expanded ? '▾' : '▸'} Вызовы Claude ({stageRun.aiCalls.length})
          </button>
          {expanded && (
            <AiCallsTable calls={stageRun.aiCalls} onOpen={onAiCallClick} />
          )}
        </div>
      )}

      {stageRun.metadata && Object.keys(stageRun.metadata).length > 0 && (
        <details style={{ marginTop: 10, fontSize: 12 }}>
          <summary style={{ cursor: 'pointer', color: 'var(--text-muted)' }}>metadata</summary>
          <pre
            style={{
              marginTop: 6,
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              fontSize: 11,
              background: 'var(--bg-subtle)',
              padding: 8,
              borderRadius: 4,
            }}
          >
            {JSON.stringify(stageRun.metadata, null, 2)}
          </pre>
        </details>
      )}
    </div>
  );
}

function AiCallsTable({
  calls,
  onOpen,
}: {
  calls: AiCallLite[];
  onOpen: (callId: string) => void;
}) {
  return (
    <div style={{ overflowX: 'auto', marginTop: 8 }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
        <thead>
          <tr>
            <th style={th}>Назначение</th>
            <th style={th}>Модель</th>
            <th style={th}>#</th>
            <th style={th}>Время</th>
            <th style={th}>Latency</th>
            <th style={th}>Токены (in / out)</th>
            <th style={th}>Кэш (create / read)</th>
            <th style={th}>Статус</th>
            <th style={th}></th>
          </tr>
        </thead>
        <tbody>
          {calls.map((c) => (
            <tr key={c.id}>
              <td style={td}>{PURPOSE_LABELS[c.purpose]}</td>
              <td style={td}>{modelLabel(c.model)}</td>
              <td style={td}>{c.attempt}</td>
              <td style={td} title={fmtDateTime(c.startedAt)}>
                {fmtDateTime(c.startedAt).slice(11)}
              </td>
              <td style={td}>{fmtDuration(c.latencyMs)}</td>
              <td style={td}>
                {fmtTokens(c.inputTokens)} / {fmtTokens(c.outputTokens)}
              </td>
              <td style={td}>
                {fmtTokens(c.cacheCreationTokens)} / {fmtTokens(c.cacheReadTokens)}
              </td>
              <td style={td}>
                {c.error ? (
                  <span style={{ color: 'var(--danger)' }} title={c.error.message}>
                    Ошибка
                  </span>
                ) : (
                  <span style={{ color: 'var(--success)' }}>OK</span>
                )}
              </td>
              <td style={td}>
                <button
                  type="button"
                  style={{ ...btnLink, color: 'var(--accent)' }}
                  onClick={() => onOpen(c.id)}
                >
                  Показать
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function VersionsTable({
  versions,
  onSelect,
}: {
  versions: DocumentVersionLite[];
  onSelect: (version: number) => void;
}) {
  if (versions.length === 0) {
    return <div style={{ color: 'var(--text-muted)' }}>Версии не зафиксированы.</div>;
  }
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
        <thead>
          <tr>
            <th style={th}>Версия</th>
            <th style={th}>Причина</th>
            <th style={th}>Автор</th>
            <th style={th}>Создано</th>
            <th style={th}></th>
          </tr>
        </thead>
        <tbody>
          {versions.map((v) => (
            <tr key={v.id}>
              <td style={td}>v{v.version}</td>
              <td style={td}>{REASON_LABELS[v.reason]}</td>
              <td style={td}>
                {v.actorType ? ACTOR_LABELS[v.actorType] : '—'}
                {v.actorId ? (
                  <span style={{ color: 'var(--text-muted)', marginLeft: 6, fontSize: 12 }}>
                    {v.actorId.slice(0, 8)}
                  </span>
                ) : null}
              </td>
              <td style={td}>{fmtDateTime(v.createdAt)}</td>
              <td style={td}>
                <button
                  type="button"
                  style={{ ...btnLink, color: 'var(--accent)' }}
                  onClick={() => onSelect(v.version)}
                >
                  Снимок
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ModalShell({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.5)',
        zIndex: 50,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 20,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: '#fff',
          borderRadius: 8,
          width: '100%',
          maxWidth: 980,
          maxHeight: '90vh',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '12px 16px',
            borderBottom: '1px solid var(--border)',
          }}
        >
          <div style={{ fontWeight: 600 }}>{title}</div>
          <button type="button" onClick={onClose} style={btnOutline}>
            Закрыть
          </button>
        </div>
        <div style={{ overflow: 'auto', padding: 16 }}>{children}</div>
      </div>
    </div>
  );
}

function JsonBlock({ value }: { value: unknown }) {
  return (
    <pre
      style={{
        background: 'var(--ink)',
        color: '#dbe4e9',
        padding: 12,
        borderRadius: 6,
        fontSize: 12,
        lineHeight: 1.5,
        overflow: 'auto',
        maxHeight: 360,
      }}
    >
      {JSON.stringify(value, null, 2)}
    </pre>
  );
}

function AiCallModal({
  documentId,
  callId,
  onClose,
}: {
  documentId: string;
  callId: string;
  onClose: () => void;
}) {
  const [call, setCall] = useState<AiCall | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .get<AiCall>(`/documents/${documentId}/ai-calls/${callId}`)
      .then(({ data }) => {
        if (!cancelled) setCall(data);
      })
      .catch(() => {
        if (!cancelled) setErr('Не удалось загрузить вызов');
      });
    return () => {
      cancelled = true;
    };
  }, [documentId, callId]);

  return (
    <ModalShell title="Вызов Claude" onClose={onClose}>
      {err && <div style={{ color: 'var(--danger)' }}>{err}</div>}
      {!call && !err && <div style={{ color: 'var(--text-muted)' }}>Загрузка…</div>}
      {call && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ fontSize: 13, color: 'var(--text)' }}>
            <strong>{PURPOSE_LABELS[call.purpose]}</strong> · {modelLabel(call.model)} ·{' '}
            попытка {call.attempt} · {fmtDuration(call.latencyMs)} ·{' '}
            {fmtTokens(call.inputTokens)} in / {fmtTokens(call.outputTokens)} out
          </div>
          {call.error && (
            <div
              style={{
                padding: 10,
                background: 'var(--danger-soft)',
                border: '1px solid var(--danger-soft-border)',
                borderRadius: 6,
                fontSize: 12,
                color: 'var(--danger-strong)',
              }}
            >
              {call.error.message}
            </div>
          )}
          <div>
            <div style={{ fontWeight: 600, marginBottom: 6 }}>Запрос</div>
            <JsonBlock value={call.request} />
          </div>
          <div>
            <div style={{ fontWeight: 600, marginBottom: 6 }}>Ответ</div>
            <JsonBlock value={call.response} />
          </div>
        </div>
      )}
    </ModalShell>
  );
}

function VersionModal({
  documentId,
  version,
  onClose,
}: {
  documentId: string;
  version: number;
  onClose: () => void;
}) {
  const [data, setData] = useState<DocumentVersion | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .get<DocumentVersion>(`/documents/${documentId}/versions/${version}`)
      .then(({ data: d }) => {
        if (!cancelled) setData(d);
      })
      .catch(() => {
        if (!cancelled) setErr('Не удалось загрузить версию');
      });
    return () => {
      cancelled = true;
    };
  }, [documentId, version]);

  return (
    <ModalShell title={`Снимок версии v${version}`} onClose={onClose}>
      {err && <div style={{ color: 'var(--danger)' }}>{err}</div>}
      {!data && !err && <div style={{ color: 'var(--text-muted)' }}>Загрузка…</div>}
      {data && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ fontSize: 13, color: 'var(--text)' }}>
            Причина: <strong>{REASON_LABELS[data.reason]}</strong> · Валюта:{' '}
            {data.snapshot.currency ?? '—'}
          </div>
          <ParsedSnapshotTable rows={data.snapshot.parsedData ?? []} />
          {data.snapshot.columnMapping && (
            <details>
              <summary style={{ cursor: 'pointer', color: 'var(--text-muted)', fontSize: 13 }}>
                columnMapping
              </summary>
              <JsonBlock value={data.snapshot.columnMapping} />
            </details>
          )}
        </div>
      )}
    </ModalShell>
  );
}

function ParsedSnapshotTable({ rows }: { rows: ParsedDataRow[] | Record<string, unknown>[] }) {
  if (!rows || rows.length === 0) {
    return <div style={{ color: 'var(--text-muted)' }}>Нет данных.</div>;
  }
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
        <thead>
          <tr>
            <th style={th}>#</th>
            <th style={th}>Наименование</th>
            <th style={th}>Кол-во</th>
            <th style={th}>Цена</th>
            <th style={th}>Вес</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => {
            const row = r as ParsedDataRow;
            return (
              <tr key={i}>
                <td style={td}>{i + 1}</td>
                <td style={td}>{row.description}</td>
                <td style={td}>{row.quantity}</td>
                <td style={td}>{fmt(row.price)}</td>
                <td style={td}>{row.weight}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
