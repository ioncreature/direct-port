'use client';

import { useState, useEffect } from 'react';
import { useCalculationConfig } from '@/hooks/use-calculation-config';

export default function SettingsPage() {
  const { config, loading, saving, error, save } = useCalculationConfig();

  const [pricePercent, setPricePercent] = useState('');
  const [weightRate, setWeightRate] = useState('');
  const [fixedFee, setFixedFee] = useState('');
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    if (config) {
      setPricePercent(String(config.pricePercent));
      setWeightRate(String(config.weightRate));
      setFixedFee(String(config.fixedFee));
    }
  }, [config]);

  if (loading) return <p>Загрузка...</p>;

  const handleSave = async () => {
    setSuccess(false);
    await save({
      pricePercent: Number(pricePercent),
      weightRate: Number(weightRate),
      fixedFee: Number(fixedFee),
    });
    setSuccess(true);
    setTimeout(() => setSuccess(false), 3000);
  };

  return (
    <div>
      <h1 style={{ marginBottom: 24 }}>Настройки расчётов</h1>

      <div style={{ maxWidth: 500, padding: 24, border: '1px solid #ddd', borderRadius: 8 }}>
        <h3 style={{ marginBottom: 16 }}>Формула комиссии за доставку</h3>
        <p style={{ fontSize: 14, color: '#666', marginBottom: 20 }}>
          Комиссия = (Стоимость × X%) + (Вес × Y) + Фикс. сбор
        </p>

        <div style={{ marginBottom: 16 }}>
          <label style={labelStyle}>Процент от стоимости (X%)</label>
          <input
            type="number"
            step="0.01"
            min="0"
            value={pricePercent}
            onChange={(e) => setPricePercent(e.target.value)}
            style={inputStyle}
          />
        </div>

        <div style={{ marginBottom: 16 }}>
          <label style={labelStyle}>Ставка за кг веса (Y)</label>
          <input
            type="number"
            step="0.01"
            min="0"
            value={weightRate}
            onChange={(e) => setWeightRate(e.target.value)}
            style={inputStyle}
          />
        </div>

        <div style={{ marginBottom: 20 }}>
          <label style={labelStyle}>Фиксированный сбор за позицию</label>
          <input
            type="number"
            step="0.01"
            min="0"
            value={fixedFee}
            onChange={(e) => setFixedFee(e.target.value)}
            style={inputStyle}
          />
        </div>

        {error && <p style={{ color: '#dc2626', marginBottom: 12 }}>{error}</p>}
        {success && <p style={{ color: '#16a34a', marginBottom: 12 }}>Сохранено!</p>}

        <button
          onClick={handleSave}
          disabled={saving}
          style={{
            padding: '10px 24px',
            background: '#2563eb',
            color: 'white',
            border: 'none',
            borderRadius: 4,
            cursor: saving ? 'wait' : 'pointer',
            opacity: saving ? 0.7 : 1,
          }}
        >
          {saving ? 'Сохранение...' : 'Сохранить'}
        </button>

        {config?.updatedAt && (
          <p style={{ fontSize: 12, color: '#999', marginTop: 12 }}>
            Последнее обновление: {new Date(config.updatedAt).toLocaleString('ru')}
          </p>
        )}
      </div>
    </div>
  );
}

const labelStyle: React.CSSProperties = {
  display: 'block',
  marginBottom: 4,
  fontSize: 14,
  fontWeight: 500,
};

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '8px 12px',
  border: '1px solid #ddd',
  borderRadius: 4,
  fontSize: 14,
};
