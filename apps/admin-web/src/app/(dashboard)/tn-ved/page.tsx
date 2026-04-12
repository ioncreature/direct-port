'use client';

import { useTnVed } from '@/hooks/use-tn-ved';
import { td, th } from '@/lib/table-styles';
import type { TnVedCodeDetail, TnVedRateInfo, TnVedSearchResultItem } from '@/lib/types';
import { useCallback, useState } from 'react';

const thRight: React.CSSProperties = { ...th, textAlign: 'right' };
const tdRight: React.CSSProperties = { ...td, textAlign: 'right' };
const labelStyle: React.CSSProperties = { color: '#888', marginRight: 4 };

export default function TnVedPage() {
  const { query, setQuery, result, loading, debouncing, searchImmediate } = useTnVed();
  const busy = debouncing || loading;

  const onCodeClick = useCallback(
    (code: string) => searchImmediate(code.replace(/\D/g, '')),
    [searchImmediate],
  );

  return (
    <div>
      <h1 style={{ marginBottom: 24 }}>Справочник ТН ВЭД</h1>

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 24 }}>
        <input
          type="text"
          placeholder="Введите код ТН ВЭД или название товара..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          style={{
            width: '100%',
            maxWidth: 500,
            padding: '10px 14px',
            fontSize: 15,
            border: '1px solid #ddd',
            borderRadius: 6,
            boxSizing: 'border-box',
          }}
        />
        {busy && <Spinner />}
      </div>

      {result?.translatedQuery && (
        <p style={{ color: '#666', fontSize: 14, marginBottom: 16 }}>
          Перевод запроса: &laquo;{result.translatedQuery}&raquo;
        </p>
      )}

      {result?.mode === 'code_lookup' && result.codeDetail && (
        <CodeDetailCard detail={result.codeDetail} />
      )}

      {result?.mode === 'code_lookup' && result.results.length > 0 && (
        <>
          <h3 style={{ margin: '24px 0 12px' }}>Примеры деклараций</h3>
          <ResultsTable items={result.results} onCodeClick={onCodeClick} />
        </>
      )}

      {result?.mode === 'text_search' && result.results.length > 0 && (
        <>
          <ResultsTable items={result.results} onCodeClick={onCodeClick} />
          <p style={{ fontSize: 12, color: '#999', marginTop: 12 }}>
            Найдено {result.totalFound} результатов, показано {result.results.length}
          </p>
        </>
      )}

      {!busy && result?.mode === 'text_search' && result.results.length === 0 && query.trim() && (
        <p style={{ color: '#888' }}>Ничего не найдено</p>
      )}

      {!busy && !query.trim() && (
        <p style={{ color: '#888' }}>
          Введите код ТН ВЭД или название товара для поиска (русский, английский, китайский)
        </p>
      )}

      <style>{`@keyframes tn-ved-spin { to { transform: rotate(360deg) } }`}</style>
    </div>
  );
}

function Spinner() {
  return (
    <div
      style={{
        width: 20,
        height: 20,
        border: '2px solid #ddd',
        borderTopColor: '#555',
        borderRadius: '50%',
        animation: 'tn-ved-spin 0.6s linear infinite',
        flexShrink: 0,
      }}
    />
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(text).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      },
      () => {},
    );
  };

  return (
    <button
      onClick={handleCopy}
      title="Копировать код"
      style={{
        background: 'none',
        border: '1px solid #ccc',
        borderRadius: 4,
        padding: '2px 8px',
        cursor: 'pointer',
        fontSize: 12,
        color: copied ? '#16a34a' : '#666',
      }}
    >
      {copied ? 'Скопировано' : 'Копировать'}
    </button>
  );
}

function CodeDetailCard({ detail }: { detail: TnVedCodeDetail }) {
  return (
    <div
      style={{
        padding: 20,
        border: '1px solid #ddd',
        borderRadius: 8,
        backgroundColor: '#f9f9f9',
      }}
    >
      <div style={{ display: 'flex', gap: 16, alignItems: 'center', marginBottom: 12 }}>
        <code style={{ fontSize: 18, fontWeight: 600 }}>{formatCode(detail.code)}</code>
        <CopyButton text={detail.code} />
        <span style={{ fontSize: 15 }}>{detail.description}</span>
      </div>

      <div style={{ display: 'flex', gap: 32, flexWrap: 'wrap', fontSize: 14 }}>
        <div>
          <span style={labelStyle}>Пошлина:</span> {formatDutyRate(detail.rates)}
        </div>
        <div>
          <span style={labelStyle}>НДС:</span> {detail.rates.vatRate}%
        </div>
        {detail.rates.exciseRate > 0 && (
          <div>
            <span style={labelStyle}>Акциз:</span> {detail.rates.exciseRate}%
          </div>
        )}
        {detail.dateBegin && (
          <div>
            <span style={labelStyle}>Действует с:</span> {detail.dateBegin}
          </div>
        )}
        {detail.dateEnd && (
          <div>
            <span style={labelStyle}>Действует до:</span> {detail.dateEnd}
          </div>
        )}
      </div>

      {detail.notes && (
        <p style={{ marginTop: 12, fontSize: 13, color: '#666' }}>{detail.notes}</p>
      )}
    </div>
  );
}

function ResultsTable({
  items,
  onCodeClick,
}: {
  items: TnVedSearchResultItem[];
  onCodeClick: (code: string) => void;
}) {
  return (
    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
      <thead>
        <tr>
          <th style={th}>Код</th>
          <th style={{ ...th, width: '40%' }}>Описание</th>
          <th style={thRight}>Частота</th>
          <th style={thRight}>Пошлина</th>
          <th style={thRight}>НДС</th>
          <th style={thRight}>Акциз</th>
        </tr>
      </thead>
      <tbody>
        {items.map((item) => (
          <tr key={item.code}>
            <td style={td}>
              <code
                onClick={() => onCodeClick(item.code)}
                style={{
                  fontSize: 13,
                  cursor: 'pointer',
                  color: '#2563eb',
                  textDecoration: 'underline',
                  textDecorationColor: '#93c5fd',
                }}
              >
                {formatCode(item.code)}
              </code>
            </td>
            <td style={{ ...td, fontSize: 14 }}>{item.description}</td>
            <td style={tdRight}>{item.count}</td>
            <td style={tdRight}>{formatDutyRate(item.rates)}</td>
            <td style={tdRight}>{item.rates.vatRate}%</td>
            <td style={tdRight}>{item.rates.exciseRate > 0 ? `${item.rates.exciseRate}%` : '—'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function formatDutyRate(rates: TnVedRateInfo): string {
  if (!rates.dutyRate && !rates.dutyMin) return '0%';
  let text = `${rates.dutyRate}%`;
  if (rates.dutySign && rates.dutyMin) {
    text += ` но не менее ${rates.dutyMin} ${rates.dutyMinUnit || 'EUR/кг'}`;
  }
  return text;
}

function formatCode(code: string): string {
  if (code.length !== 10) return code;
  return `${code.slice(0, 4)} ${code.slice(4, 6)} ${code.slice(6, 9)} ${code.slice(9)}`;
}
