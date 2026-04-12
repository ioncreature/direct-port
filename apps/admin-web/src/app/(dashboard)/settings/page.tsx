'use client';

import { type AiModelTier, useAiConfig } from '@/hooks/use-ai-config';
import { useCalculationConfig } from '@/hooks/use-calculation-config';
import { useEffect, useState } from 'react';

// --- Описание шагов AI ---

interface AiStepInfo {
  key: 'parserModel' | 'classifierModel' | 'interpreterModel';
  title: string;
  description: string;
  recommended: AiModelTier;
  tiers: Record<AiModelTier, string>;
}

const AI_STEPS: AiStepInfo[] = [
  {
    key: 'parserModel',
    title: 'Парсинг документов',
    description:
      'Анализ структуры таблицы, определение валюты, перевод описаний товаров (часто с китайского) на русский, извлечение данных.',
    recommended: 'sonnet',
    tiers: {
      opus: 'Максимальное качество перевода и анализа. Высокая стоимость.',
      sonnet: 'Оптимальный баланс качества и стоимости. Хорошо справляется с китайским.',
      haiku: 'Не рекомендуется — заметно теряет качество перевода с китайского.',
    },
  },
  {
    key: 'classifierModel',
    title: 'Классификация ТН ВЭД',
    description:
      'Выбор кода ТН ВЭД из кандидатов справочника TKS. При отсутствии кандидатов — предлагает код самостоятельно.',
    recommended: 'sonnet',
    tiers: {
      opus: 'Для сложных товаров: химия, специализированное оборудование, фармацевтика.',
      sonnet: 'Подходит для большинства товаров. Рекомендуется как базовый вариант.',
      haiku: 'Допустим для простых товаров (одежда, электроника), если TKS даёт хороших кандидатов.',
    },
  },
  {
    key: 'interpreterModel',
    title: 'Интерпретация пошлин',
    description:
      'Перевод ставок из справочника ТН ВЭД в формализованные правила расчёта: комбинированные ставки, специфические пошлины (EUR/кг, EUR/м²), акцизы.',
    recommended: 'haiku',
    tiers: {
      opus: 'Избыточен для данной задачи — правила хорошо формализованы.',
      sonnet: 'Работает, но для формализованных правил избыточен по стоимости.',
      haiku: 'Лучшее соотношение цена/качество. Задача чётко структурирована.',
    },
  },
];

const TIER_LABELS: Record<AiModelTier, string> = {
  opus: 'Opus',
  sonnet: 'Sonnet',
  haiku: 'Haiku',
};

// --- Компонент ---

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
      <p style={{ fontSize: 14, color: '#666', marginBottom: 24 }}>
        Выберите модель Claude для каждого этапа обработки документов.
        Более мощные модели дают лучшее качество, но стоят дороже.
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
    <div style={{ marginBottom: 24, padding: 16, background: '#f9fafb', borderRadius: 8 }}>
      <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 4 }}>{step.title}</div>
      <div style={{ fontSize: 13, color: '#666', marginBottom: 12 }}>{step.description}</div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {(['opus', 'sonnet', 'haiku'] as AiModelTier[]).map((tier) => {
          const isSelected = value === tier;
          const isRecommended = step.recommended === tier;

          return (
            <label
              key={tier}
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: 10,
                padding: '10px 12px',
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
                style={{ marginTop: 3 }}
              />
              <div>
                <span style={{ fontWeight: 500, fontSize: 14 }}>
                  {TIER_LABELS[tier]}
                </span>
                {isRecommended && (
                  <span
                    style={{
                      marginLeft: 8,
                      fontSize: 11,
                      padding: '2px 8px',
                      background: '#dcfce7',
                      color: '#166534',
                      borderRadius: 10,
                      fontWeight: 500,
                    }}
                  >
                    рекомендуется
                  </span>
                )}
                <div style={{ fontSize: 12, color: '#666', marginTop: 2 }}>{step.tiers[tier]}</div>
              </div>
            </label>
          );
        })}
      </div>
    </div>
  );
}

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
