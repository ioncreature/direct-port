'use client';

import { useTnVed } from '@/hooks/use-tn-ved';
import { fmt } from '@/lib/format';
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
        <code style={{ fontSize: 18, fontWeight: 600, whiteSpace: 'nowrap' }}>{formatCode(detail.code)}</code>
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

      <DutyCalculator rates={detail.rates} />
    </div>
  );
}

interface DimensionInfo {
  unit: string;
  label: string;
}

function parseDutyUnit(dutyMinUnit: string | null): DimensionInfo | null {
  if (!dutyMinUnit) return null;
  const raw = dutyMinUnit.split('/')[1]?.trim();
  if (!raw) return null;
  const map: Record<string, DimensionInfo | null> = {
    'кг': { unit: 'кг', label: 'Вес' },
    'kg': { unit: 'кг', label: 'Вес' },
    'г': { unit: 'г', label: 'Вес' },
    'т': { unit: 'т', label: 'Вес' },
    'л': { unit: 'л', label: 'Объём' },
    'l': { unit: 'л', label: 'Объём' },
    'м2': { unit: 'м²', label: 'Площадь' },
    'м²': { unit: 'м²', label: 'Площадь' },
    'm2': { unit: 'м²', label: 'Площадь' },
    'м3': { unit: 'м³', label: 'Объём' },
    'м³': { unit: 'м³', label: 'Объём' },
    'm3': { unit: 'м³', label: 'Объём' },
    'шт': null,
    'pcs': null,
  };
  const info = map[raw.toLowerCase()];
  return info === undefined ? { unit: raw, label: raw } : info;
}

function DutyCalculator({ rates }: { rates: TnVedRateInfo }) {
  const [price, setPrice] = useState('');
  const [qty, setQty] = useState('');
  const [dim, setDim] = useState('');

  const dimInfo = parseDutyUnit(rates.dutyMinUnit);
  const hasSpecific = rates.dutyMin != null && rates.dutyMin > 0 && !!rates.dutyMinUnit;

  const p = parseFloat(price) || 0;
  const q = parseFloat(qty) || 0;
  const d = parseFloat(dim) || 0;

  const totalPrice = p * q;
  const canCalc = totalPrice > 0;

  let dutyAmount = 0;
  let specificAmount: number | null = null;

  if (canCalc) {
    const adValorem = totalPrice * (rates.dutyRate / 100);

    if (hasSpecific) {
      const dimValue = dimInfo ? d : q;
      specificAmount = rates.dutyMin! * dimValue;
      if (rates.dutySign === '>') {
        dutyAmount = Math.max(adValorem, specificAmount);
      } else if (rates.dutySign === '<') {
        dutyAmount = Math.min(adValorem, specificAmount);
      } else {
        dutyAmount = adValorem;
      }
    } else {
      dutyAmount = adValorem;
    }
  }

  const exciseAmount = canCalc ? totalPrice * (rates.exciseRate / 100) : 0;
  const vatAmount = canCalc ? (totalPrice + dutyAmount + exciseAmount) * (rates.vatRate / 100) : 0;
  const total = totalPrice + dutyAmount + vatAmount + exciseAmount;

  return (
    <div style={{ marginTop: 16, padding: 16, border: '1px solid #e5e7eb', borderRadius: 6, backgroundColor: '#fff' }}>
      <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>Калькулятор пошлин</div>

      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
        <CalcInput label="Цена за ед." value={price} onChange={setPrice} />
        <CalcInput label="Количество" value={qty} onChange={setQty} />
        {dimInfo && (
          <CalcInput label={`${dimInfo.label}, ${dimInfo.unit}`} value={dim} onChange={setDim} />
        )}
      </div>

      {canCalc && (
        <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', fontSize: 14 }}>
          <div><span style={labelStyle}>Стоимость:</span> {fmt(totalPrice)}</div>
          <div><span style={labelStyle}>Пошлина:</span> {fmt(dutyAmount)}</div>
          {exciseAmount > 0 && <div><span style={labelStyle}>Акциз:</span> {fmt(exciseAmount)}</div>}
          <div><span style={labelStyle}>НДС:</span> {fmt(vatAmount)}</div>
          <div style={{ fontWeight: 600 }}><span style={labelStyle}>Итого:</span> {fmt(total)}</div>
        </div>
      )}

      {canCalc && hasSpecific && specificAmount != null && (
        <p style={{ fontSize: 12, color: '#888', marginTop: 8 }}>
          Специфическая ставка: {fmt(specificAmount)} {rates.dutyMinUnit?.split('/')[0] || 'EUR'}.
          {' '}Для точного сравнения с адвалорной частью необходим курс валют.
        </p>
      )}
    </div>
  );
}

function CalcInput({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div>
      <div style={{ fontSize: 12, color: '#666', marginBottom: 4 }}>{label}</div>
      <input
        type="number"
        min="0"
        step="any"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{
          width: 130,
          padding: '6px 10px',
          fontSize: 14,
          border: '1px solid #ddd',
          borderRadius: 4,
          boxSizing: 'border-box',
        }}
      />
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
                  whiteSpace: 'nowrap',
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
