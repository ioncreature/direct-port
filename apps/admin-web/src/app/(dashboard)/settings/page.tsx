'use client';

import { useAuth } from '@/hooks/use-auth';
import { AI_MODEL_TIERS, type AiConfig, type AiModelTier, useAiConfig } from '@/hooks/use-ai-config';
import { useCalculationConfig } from '@/hooks/use-calculation-config';
import { isAdminRole } from '@/lib/roles';
import { useEffect, useState } from 'react';
import { AI_STEPS, type AiStepInfo } from './ai-steps';

export default function SettingsPage() {
  const { user } = useAuth();

  // Настройки — только для admin/super_admin. customs (декларант) сюда не должен попадать
  // даже по прямому URL; API конфигов тоже отдаёт их лишь ADMIN. (layout уже прячет пункт.)
  if (user && !isAdminRole(user.role)) {
    return <p>Недостаточно прав для просмотра этого раздела.</p>;
  }

  return <SettingsContent />;
}

// Вынесено в отдельный компонент, чтобы хуки-конфиги (GET /calculation-config, /ai-config)
// не срабатывали для не-админов — они бы упёрлись в 403.
function SettingsContent() {
  const calcConfig = useCalculationConfig();

  return (
    <div>
      <h1 style={{ marginBottom: 24 }}>Настройки</h1>
      <ConfidenceSection {...calcConfig} />
      <CommissionSection {...calcConfig} />
      <AiModelsSection />
    </div>
  );
}

type CalcConfigProps = ReturnType<typeof useCalculationConfig>;

// --- Секция: Классификация ТН ВЭД ---

function ConfidenceSection({ config, loading, saving, error, save }: CalcConfigProps) {
  const [threshold, setThreshold] = useState('');
  const [action, setAction] = useState<'review' | 'reject'>('review');
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    if (config) {
      setThreshold(String(config.confidenceThreshold));
      setAction(config.lowConfidenceAction);
    }
  }, [config]);

  if (loading) return <p>Загрузка...</p>;

  const thresholdNum = Number(threshold);
  const thresholdValid = Number.isFinite(thresholdNum) && thresholdNum >= 0 && thresholdNum <= 1;
  const hasChanges =
    config &&
    (thresholdNum !== config.confidenceThreshold || action !== config.lowConfidenceAction);

  const handleSave = async () => {
    if (!thresholdValid) return;
    setSuccess(false);
    await save({ confidenceThreshold: thresholdNum, lowConfidenceAction: action });
    setSuccess(true);
    setTimeout(() => setSuccess(false), 3000);
  };

  return (
    <div style={{ maxWidth: 500, padding: 24, border: '1px solid var(--border)', borderRadius: 8, marginBottom: 32 }}>
      <h3 style={{ marginBottom: 8 }}>Классификация ТН ВЭД</h3>
      <p style={{ fontSize: 14, color: 'var(--text-muted)', marginBottom: 20, lineHeight: 1.5 }}>
        Если ИИ подобрал код ТН ВЭД с уверенностью ниже порога — документ не будет обработан
        автоматически.
      </p>

      <div style={{ marginBottom: 16 }}>
        <label style={labelStyle}>Порог уверенности (0–1)</label>
        <input
          type="number"
          step="0.01"
          min="0"
          max="1"
          value={threshold}
          onChange={(e) => setThreshold(e.target.value)}
          style={inputStyle}
        />
        {!thresholdValid && threshold !== '' && (
          <p style={{ fontSize: 12, color: 'var(--danger)', marginTop: 4 }}>
            Значение должно быть от 0 до 1
          </p>
        )}
      </div>

      <div style={{ marginBottom: 20 }}>
        <label style={labelStyle}>Действие при низкой уверенности</label>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <label style={{ display: 'flex', alignItems: 'flex-start', gap: 10, cursor: 'pointer' }}>
            <input
              type="radio"
              name="low-confidence-action"
              checked={action === 'review'}
              onChange={() => setAction('review')}
              style={{ marginTop: 3 }}
            />
            <div>
              <div style={{ fontWeight: 500, fontSize: 14 }}>Запросить уточнение у пользователя в Telegram</div>
              <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 2, lineHeight: 1.5 }}>
                Бот пришлёт пользователю карточку на каждую сомнительную позицию с тремя
                действиями: <strong>уточнить описание текстом</strong>, <strong>ввести код ТН ВЭД вручную</strong>{' '}
                или <strong>пропустить</strong>. Система пересчитает только эти строки —
                файл загружать заново не нужно. Документ также появится в админке со статусом
                «Проверка кодов» — оператор может вмешаться и одобрить или отклонить.
              </div>
            </div>
          </label>
          <label style={{ display: 'flex', alignItems: 'flex-start', gap: 10, cursor: 'pointer' }}>
            <input
              type="radio"
              name="low-confidence-action"
              checked={action === 'reject'}
              onChange={() => setAction('reject')}
              style={{ marginTop: 3 }}
            />
            <div>
              <div style={{ fontWeight: 500, fontSize: 14 }}>Сразу отклонять</div>
              <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 2, lineHeight: 1.5 }}>
                Пользователь получит сводку сомнительных строк с просьбой исправить файл и
                загрузить заново. Уточнить позиции в чате будет нельзя.
              </div>
            </div>
          </label>
        </div>
      </div>

      {error && <p style={{ color: 'var(--danger)', marginBottom: 12 }}>{error}</p>}
      {success && <p style={{ color: 'var(--success)', marginBottom: 12 }}>Сохранено!</p>}

      <button
        onClick={handleSave}
        disabled={saving || !hasChanges || !thresholdValid}
        style={btnStyle(saving || !hasChanges || !thresholdValid)}
      >
        {saving ? 'Сохранение...' : 'Сохранить'}
      </button>
    </div>
  );
}

// --- Секция: Формула комиссии ---

function CommissionSection({ config, loading, saving, error, save }: CalcConfigProps) {
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
    <div style={{ maxWidth: 500, padding: 24, border: '1px solid var(--border)', borderRadius: 8, marginBottom: 32 }}>
      <h3 style={{ marginBottom: 16 }}>Формула комиссии за доставку</h3>
      <p style={{ fontSize: 14, color: 'var(--text-muted)', marginBottom: 20 }}>
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

      {error && <p style={{ color: 'var(--danger)', marginBottom: 12 }}>{error}</p>}
      {success && <p style={{ color: 'var(--success)', marginBottom: 12 }}>Сохранено!</p>}

      <button onClick={handleSave} disabled={saving} style={btnStyle(saving)}>
        {saving ? 'Сохранение...' : 'Сохранить'}
      </button>

      {config?.updatedAt && (
        <p style={{ fontSize: 12, color: 'var(--text-subtle)', marginTop: 12 }}>
          Последнее обновление: {new Date(config.updatedAt).toLocaleString('ru')}
        </p>
      )}
    </div>
  );
}

// --- Секция: Модели AI ---

function AiModelsSection() {
  const { config, loading, saving, error, save } = useAiConfig();

  const [models, setModels] = useState<Partial<Pick<AiConfig, AiStepInfo['key']>>>({});
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    if (config) {
      setModels({
        parserModel: config.parserModel,
        queryFormulationModel: config.queryFormulationModel,
        classifierModel: config.classifierModel,
        interpreterModel: config.interpreterModel,
        photoClassifierModel: config.photoClassifierModel,
      });
    }
  }, [config]);

  if (loading) return <p>Загрузка настроек AI...</p>;

  const handleSave = async () => {
    setSuccess(false);
    await save(models);
    setSuccess(true);
    setTimeout(() => setSuccess(false), 3000);
  };

  const hasChanges = config && (
    models.parserModel !== config.parserModel ||
    models.queryFormulationModel !== config.queryFormulationModel ||
    models.classifierModel !== config.classifierModel ||
    models.interpreterModel !== config.interpreterModel ||
    models.photoClassifierModel !== config.photoClassifierModel
  );

  return (
    <div style={{ maxWidth: 700, padding: 24, border: '1px solid var(--border)', borderRadius: 8 }}>
      <h3 style={{ marginBottom: 8 }}>Модели AI</h3>
      <p style={{ fontSize: 14, color: 'var(--text-muted)', marginBottom: 12, lineHeight: 1.6 }}>
        Обработка каждого документа проходит через несколько этапов. На каждом этапе работает ИИ (Claude),
        и вы можете выбрать уровень модели — от базовой до максимальной.
      </p>
      <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 24, lineHeight: 1.5 }}>
        <strong>Opus 4.8</strong> — самая мощная и дорогая модель, лучшее качество.{' '}
        <strong>Sonnet 5</strong> — основная рабочая модель, хороший баланс.{' '}
        <strong>Haiku 4.5</strong> — самая быстрая и дешёвая, подходит для простых задач.
        Проценты точности — ориентировочные, реальные результаты зависят от ваших документов.
      </p>

      {AI_STEPS.map((step) => (
        <AiStepCard
          key={step.key}
          step={step}
          value={models[step.key] ?? step.recommended}
          onChange={(tier) => setModels((prev) => ({ ...prev, [step.key]: tier }))}
        />
      ))}

      {error && <p style={{ color: 'var(--danger)', marginBottom: 12 }}>{error}</p>}
      {success && <p style={{ color: 'var(--success)', marginBottom: 12 }}>Сохранено!</p>}

      <button onClick={handleSave} disabled={saving || !hasChanges} style={btnStyle(saving || !hasChanges)}>
        {saving ? 'Сохранение...' : 'Сохранить'}
      </button>

      {config?.updatedAt && (
        <p style={{ fontSize: 12, color: 'var(--text-subtle)', marginTop: 12 }}>
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
    <div style={{ marginBottom: 28, padding: 20, background: 'var(--bg-subtle)', borderRadius: 8 }}>
      <div style={{ fontWeight: 600, fontSize: 16, marginBottom: 6 }}>{step.title}</div>
      <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 16, lineHeight: 1.5 }}>{step.description}</div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {AI_MODEL_TIERS.map((tier) => {
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
                border: isSelected ? '2px solid var(--accent)' : '1px solid var(--border)',
                background: isSelected ? 'var(--accent-soft)' : 'var(--surface)',
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
                <div style={{ display: 'flex', gap: 16, fontSize: 12, color: 'var(--text-subtle)', marginBottom: 4 }}>
                  <span>Точность: <strong style={{ color: 'var(--text)' }}>{info.accuracy}</strong></span>
                  <span>Стоимость: <strong style={{ color: 'var(--text)' }}>{info.cost}</strong></span>
                </div>
                <div style={{ fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.4 }}>{info.description}</div>
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
  background: 'var(--success-soft)',
  color: 'var(--success-strong)',
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
  border: '1px solid var(--border)',
  borderRadius: 4,
  fontSize: 14,
};

function btnStyle(disabled?: boolean): React.CSSProperties {
  return {
    padding: '10px 24px',
    background: 'var(--orange)',
    color: 'white',
    border: 'none',
    borderRadius: 4,
    cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.5 : 1,
  };
}
