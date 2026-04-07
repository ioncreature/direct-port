'use client';

import { useTnVed } from '@/hooks/use-tn-ved';

export default function TnVedPage() {
  const { query, setQuery, results, loading } = useTnVed();

  return (
    <div>
      <h1 style={{ marginBottom: 24 }}>Справочник ТН ВЭД</h1>

      <input
        type="text"
        placeholder="Поиск по коду или описанию..."
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        style={{
          width: '100%',
          maxWidth: 500,
          padding: '10px 14px',
          fontSize: 15,
          border: '1px solid #ddd',
          borderRadius: 6,
          marginBottom: 24,
          boxSizing: 'border-box',
        }}
      />

      {loading && <p style={{ color: '#888' }}>Поиск...</p>}

      {!loading && query && results.length === 0 && (
        <p style={{ color: '#888' }}>Ничего не найдено</p>
      )}

      {!loading && !query && (
        <p style={{ color: '#888' }}>Введите код или название товара для поиска</p>
      )}

      {results.length > 0 && (
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th style={th}>Код</th>
              <th style={{ ...th, width: '40%' }}>Описание</th>
              <th style={th}>Ед. изм.</th>
              <th style={thRight}>Пошлина, %</th>
              <th style={thRight}>НДС, %</th>
              <th style={thRight}>Акциз</th>
            </tr>
          </thead>
          <tbody>
            {results.map((item) => (
              <tr key={item.id}>
                <td style={td}>
                  <code style={{ fontSize: 13 }}>{item.code}</code>
                </td>
                <td style={{ ...td, fontSize: 14 }}>
                  <span style={{ paddingLeft: Math.max(0, (item.level - 1)) * 12 }}>
                    {item.description}
                  </span>
                </td>
                <td style={td}>{item.unit || '—'}</td>
                <td style={tdRight}>{item.dutyRate}</td>
                <td style={tdRight}>{item.vatRate}</td>
                <td style={tdRight}>{item.exciseRate > 0 ? item.exciseRate : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {results.length > 0 && (
        <p style={{ fontSize: 12, color: '#999', marginTop: 12 }}>
          Показано {results.length} {results.length === 50 ? '(макс.)' : ''} результатов
        </p>
      )}
    </div>
  );
}

const th: React.CSSProperties = { textAlign: 'left', padding: '8px 12px', borderBottom: '2px solid #ddd' };
const thRight: React.CSSProperties = { ...th, textAlign: 'right' };
const td: React.CSSProperties = { padding: '8px 12px', borderBottom: '1px solid #eee' };
const tdRight: React.CSSProperties = { ...td, textAlign: 'right' };
