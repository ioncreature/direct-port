'use client';

import { type AiModelTier, useAiConfig } from '@/hooks/use-ai-config';
import { useCalculationConfig } from '@/hooks/use-calculation-config';
import { useEffect, useState } from 'react';
import { AI_STEPS, type AiStepInfo } from './ai-steps';

export default function SettingsPage() {
  return (
    <div>
      <h1 style={{ marginBottom: 24 }}>Настройки</h1>
      <CommissionSection />
      <AiModelsSection />
    </div>
  );
}

// --- Секция: Формула комиссии ---

function CommissionSection() {
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
    <div style={{ maxWidth: 500, padding: 24, border: '1px solid #ddd', borderRadius: 8, marginBottom: 32 }}>
      <h3 style={{ marginBottom: 16 }}>Формула комиссии за доставку</h3>
      <p style={{ fontSize: 14, color: '#666', marginBottom: 20 }}>
        Комиссия = (Стоимость × X%) + (Вес × Y) + Фикс. сбор
      </p>

      <div style={{ marginBottom: 16 }}>
        <label style={labelStyle}>Процент от стоимости (X%)</label>
        <input type="number" step="0.01" min="0" value={pricePercent} onChange={(e) => setPricePercent(e.target.value)} style={inputStyle} />
      </div>

      <div style={{ marginBottom: 16 }}>
        <label style={labelStyle}>Ставка за кг веса (Y)</label>
        <input type="number" step="0.01" min="0" value={weightRate} onChange={(e) => setWeightRate(e.target.value)} style={inputStyle} />
      </div>

      <div style={{ marginBottom: 20 }}>
        <label style={labelStyle}>Фиксированный сбор за позицию</label>
        <input type="number" step="0.01" min="0" value={fixedFee} onChange={(e) => setFixedFee(e.target.value)} style={inputStyle} />
      </div>

      {error && <p style={{ color: '#dc2626', marginBottom: 12 }}>{error}</p>}
      {success && <p style={{ color: '#16a34a', marginBottom: 12 }}>Сохранено!</p>}

      <button onClick={handleSave} disabled={saving} style={btnStyle(saving)}>
        {saving ? 'Сохранение...' : 'Сохранить'}
      </button>

      {config?.updatedAt && (
        <p style={{ fontSize: 12, color: '#999', marginTop: 12 }}>
          Последнее обновление: {new Date(config.updatedAt).toLocaleString('ru')}
        </p>
      )}
    </div>
  );
}

// --- Секция: Модели AI ---

function AiModelsSection() {
  const { config, loading, saving, error, save } = useAiConfig();

  const [models, setModels] = useState<Record<string, AiModelTier>>({});
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    if (config) {
      setModels({
        parserModel: config.parserModel,
        classifierModel: config.classifierModel,
        interpreterModel: config.interpreterModel,
      });
    }
  }, [config]);

  if (loading) return <p>Загрузка настроек AI...</p>;

  const handleSave = async () => {
    setSuccess(false);
    await save(models as Record<'parserModel' | 'classifierModel' | 'interpreterModel', AiModelTier>);
    setSuccess(true);
    setTimeout(() => setSuccess(false), 3000);
  };

  const hasChanges = config && (
    models.parserModel !== config.parserModel ||
    models.classifierModel !== config.classifierModel ||
    models.interpreterModel !== config.interpreterModel
  );

  return (
    <div style={{ maxWidth: 700, padding: 24, border: '1px solid #ddd', borderRadius: 8 }}>
      <h3 style={{ marginBottom: 8 }}>Модели AI</h3>
      <p style={{ fontSize: 14, color: '#555', marginBottom: 12, lineHeight: 1.6 }}>
        Обработка каждого документа проходит через три этапа. На каждом этапе работает ИИ (Claude),
        и вы можете выбрать уровень модели — от базовой до максимальной.
      </p>
      <p style={{ fontSize: 13, color: '#777', marginBottom: 24, lineHeight: 1.5 }}>
        <strong>Opus</strong> — самая мощная и дорогая модель, лучшее качество.{' '}
        <strong>Sonnet</strong> — основная рабочая модель, хороший баланс.{' '}
        <strong>Haiku</strong> — самая быстрая и дешёвая, подходит для простых задач.
        Проценты точности — ориентировочные, реальные результаты зависят от ваших документов.
      </p>

      {AI_STEPS.map((step) => (
        <AiStepCard
          key={step.key}
          step={step}
          value={(models[step.key] as AiModelTier) ?? 'sonnet'}
          onChange={(tier) => setModels((prev) => ({ ...prev, [step.key]: tier }))}
        />
      ))}

      {error && <p style={{ color: '#dc2626', marginBottom: 12 }}>{error}</p>}
      {success && <p style={{ color: '#16a34a', marginBottom: 12 }}>Сохранено!</p>}

      <button onClick={handleSave} disabled={saving || !hasChanges} style={btnStyle(saving || !hasChanges)}>
        {saving ? 'Сохранение...' : 'Сохранить'}
      </button>

      {config?.updatedAt && (
        <p style={{ fontSize: 12, color: '#999', marginTop: 12 }}>
          Последнее обновление: {new Date(config.updatedAt).toLocaleString('ru')}
        </p>
      )}
    </div>
  );
}

function AiStepCard({
  step,
  value,
  onChange,
}: {
  step: AiStepInfo;
  value: AiModelTier;
  onChange: (tier: AiModelTier) => void;
}) {
  return (
    <div style={{ marginBottom: 28, padding: 20, background: '#f9fafb', borderRadius: 8 }}>
      <div style={{ fontWeight: 600, fontSize: 16, marginBottom: 6 }}>{step.title}</div>
      <div style={{ fontSize: 13, color: '#555', marginBottom: 16, lineHeight: 1.5 }}>{step.description}</div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {(['opus', 'sonnet', 'haiku'] as AiModelTier[]).map((tier) => {
          const info = step.tiers[tier];
          const isSelected = value === tier;
          const isRecommended = step.recommended === tier;

          return (
            <label
              key={tier}
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: 10,
                padding: '12px 14px',
                borderRadius: 6,
                border: isSelected ? '2px solid #2563eb' : '1px solid #e5e7eb',
                background: isSelected ? '#eff6ff' : 'white',
                cursor: 'pointer',
              }}
            >
              <input
                type="radio"
                name={step.key}
                checked={isSelected}
                onChange={() => onChange(tier)}
                style={{ marginTop: 4 }}
              />
              <div style={{ flex: 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                  <span style={{ fontWeight: 600, fontSize: 14 }}>{info.label}</span>
                  {isRecommended && (
                    <span style={recommendedBadge}>рекомендуется</span>
                  )}
                </div>
                <div style={{ display: 'flex', gap: 16, fontSize: 12, color: '#888', marginBottom: 4 }}>
                  <span>Точность: <strong style={{ color: '#333' }}>{info.accuracy}</strong></span>
                  <span>Стоимость: <strong style={{ color: '#333' }}>{info.cost}</strong></span>
                </div>
                <div style={{ fontSize: 13, color: '#555', lineHeight: 1.4 }}>{info.description}</div>
              </div>
            </label>
          );
        })}
      </div>
    </div>
  );
}

const recommendedBadge: React.CSSProperties = {
  fontSize: 11,
  padding: '2px 8px',
  background: '#dcfce7',
  color: '#166534',
  borderRadius: 10,
  fontWeight: 500,
};

// --- Стили ---

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

function btnStyle(disabled?: boolean): React.CSSProperties {
  return {
    padding: '10px 24px',
    background: '#2563eb',
    color: 'white',
    border: 'none',
    borderRadius: 4,
    cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.5 : 1,
  };
}
