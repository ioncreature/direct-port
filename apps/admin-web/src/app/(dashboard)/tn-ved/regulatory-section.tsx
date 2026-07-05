'use client';

import type { RegulatoryExplanationsState } from '@/hooks/use-regulatory-explanations';
import { fmtIsoDate, fmtPeriod } from '@/lib/format';
import type {
  AssessmentForm,
  MatchPrecision,
  RegulatoryItem,
  RegulatoryReport,
} from '@/lib/types';
import { useState } from 'react';

const FORM_LABELS: Record<AssessmentForm, string> = {
  declaration: 'Декларация о соответствии',
  certificate: 'Сертификат соответствия',
  state_registration: 'Свидетельство о государственной регистрации (СГР)',
  notification: 'Нотификация',
  permit: 'Разрешение / заключение',
  license: 'Лицензия',
  fee: 'Обязательный платёж',
  unknown: 'Форма не распознана',
};

const PRECISION_BADGES: Record<MatchPrecision, { label: string; bg: string; fg: string; tooltip: string }> = {
  exact: {
    label: 'Точное совпадение',
    bg: 'var(--success-soft)',
    fg: 'var(--success-strong)',
    tooltip: 'Запись справочника привязана к этому 10-значному коду или его 8-значной подсубпозиции.',
  },
  narrow: {
    label: 'Товарная позиция',
    bg: 'var(--warning-soft)',
    fg: 'var(--warning-strong)',
    tooltip:
      'Запись охватывает товарную позицию (4–7 знаков) — мера почти наверняка применима, но рекомендуется проверка по характеристикам.',
  },
  broad: {
    label: 'Широкий охват',
    bg: 'var(--danger-soft)',
    fg: 'var(--danger-strong)',
    tooltip:
      'Запись охватывает крупную группу/раздел (≤3 знаков). Без характеристик товара возможны ложные срабатывания — обязательно перепроверить у брокера.',
  },
};

interface SectionConfig {
  key: keyof Omit<RegulatoryReport, 'totalCount'>;
  title: string;
  description?: string;
}

const SECTIONS: SectionConfig[] = [
  {
    key: 'certifications',
    title: 'Подтверждение соответствия',
    description: 'Технические регламенты ТС/ЕАЭС: декларация, сертификат, госрегистрация.',
  },
  {
    key: 'permits',
    title: 'Разрешения и заключения',
    description: 'Например, разрешения Минцифры на ввоз РЭС, заключения Минобороны.',
  },
  {
    key: 'licenses',
    title: 'Лицензии (Минпромторг и др.)',
    description:
      'Лицензии нетарифного регулирования — обычно для конкретных перечней (опасные отходы, военка).',
  },
  {
    key: 'marking',
    title: 'Обязательная маркировка («Честный знак»)',
  },
  {
    key: 'traceability',
    title: 'Прослеживаемость',
  },
  {
    key: 'utilizationFee',
    title: 'Утилизационный / экологический сбор',
  },
  {
    key: 'strategicAndDualUse',
    title: 'Стратегические товары и двойное назначение',
  },
  {
    key: 'countryRestrictions',
    title: 'Запреты и санкции по странам',
    description:
      'Меры действуют только при совпадении страны происхождения. Сверьте поле «Страна» в карточках ниже с фактической страной происхождения товара.',
  },
  {
    key: 'other',
    title: 'Прочие меры регулирования',
  },
];

/** Страна происхождения товара (строки или документа) для фильтрации страновых мер. */
export interface OriginCountry {
  code: string;
  name: string;
}

interface SectionSplit {
  cfg: SectionConfig;
  /** Применимые: точные/узкие совпадения, страна меры не противоречит стране происхождения. */
  applicable: RegulatoryItem[];
  /** Записи с широким охватом кода (≤3 знаков) — высокий риск ложного срабатывания. */
  broad: RegulatoryItem[];
  /** Меры других стран: заведомо не относятся к переданной стране происхождения. */
  foreign: RegulatoryItem[];
}

export function RegulatoryRequirementsSection({
  report,
  explanations,
  originCountry,
}: {
  report: RegulatoryReport;
  explanations: RegulatoryExplanationsState;
  /** Если задана, страновые меры других стран сворачиваются как неприменимые. */
  originCountry?: OriginCountry | null;
}) {
  if (report.totalCount === 0) {
    return (
      <div style={{ marginTop: 24 }}>
        <h3 style={{ margin: '0 0 12px' }}>Разрешительные документы и ограничения</h3>
        <p style={{ color: 'var(--text-muted)', fontSize: 14 }}>
          По справочнику TKS для этого кода нет разрешительных мер. Это не гарантирует отсутствие
          требований — окончательно подтверждайте у органа по сертификации или таможенного брокера.
        </p>
      </div>
    );
  }

  const isForeign = (item: RegulatoryItem) =>
    !!originCountry && !!item.countryCode && item.countryCode !== originCountry.code;

  const sections: SectionSplit[] = SECTIONS.map((cfg) => {
    const items = report[cfg.key];
    return {
      cfg,
      applicable: items.filter((i) => !isForeign(i) && i.matchPrecision !== 'broad'),
      broad: items.filter((i) => !isForeign(i) && i.matchPrecision === 'broad'),
      foreign: items.filter(isForeign),
    };
  });

  const applicableCount = sections.reduce((s, x) => s + x.applicable.length, 0);
  const broadCount = sections.reduce((s, x) => s + x.broad.length, 0);
  const foreignItems = sections.flatMap((x) => x.foreign);
  const foreignNames = [...new Set(foreignItems.map((i) => i.countryName ?? i.countryCode))];
  const hiddenCount = broadCount + foreignItems.length;

  return (
    <div style={{ marginTop: 24 }}>
      <h3 style={{ margin: '0 0 6px' }}>
        Разрешительные документы и ограничения{' '}
        <span style={{ fontSize: 13, color: 'var(--text-muted)', fontWeight: 'normal' }}>
          ({applicableCount} применимо
          {hiddenCount > 0 && ` · ${hiddenCount} скрыто как маловероятные`}
          )
        </span>
      </h3>
      <p style={{ color: 'var(--text-muted)', fontSize: 13, margin: '0 0 14px' }}>
        Информация носит справочный характер на основе ТН ВЭД-справочника TKS. Окончательный
        список документов подтверждается в органе по сертификации / у таможенного брокера.
      </p>
      {explanations.status === 'loading' && (
        <p style={{ color: 'var(--accent)', fontSize: 12, margin: '0 0 14px' }}>
          AI-выжимки загружаются…
        </p>
      )}
      {explanations.status === 'error' && (
        <p style={{ color: 'var(--danger-strong)', fontSize: 12, margin: '0 0 14px' }}>
          AI-выжимки недоступны: {explanations.message}. Показаны базовые сводки.
        </p>
      )}

      {applicableCount === 0 && (
        <p style={{ color: 'var(--text-muted)', fontSize: 13, margin: '0 0 14px' }}>
          Уверенно применимых мер не найдено — просмотрите скрытые группы ниже.
        </p>
      )}

      {sections.map(({ cfg, applicable }) => {
        if (applicable.length === 0) return null;
        return (
          <RegulatorySubSection
            key={cfg.key}
            title={cfg.title}
            description={cfg.description}
            items={applicable}
            explanations={explanations}
          />
        );
      })}

      {broadCount > 0 && (
        <CollapsedGroup
          title={`Записи с широким охватом кода (${broadCount})`}
          hint="Привязаны к крупной группе ТН ВЭД (≤3 знаков) — чаще всего не относятся к конкретному товару. Раскройте для проверки."
        >
          {sections.map(({ cfg, broad }) => {
            if (broad.length === 0) return null;
            return (
              <RegulatorySubSection
                key={cfg.key}
                title={cfg.title}
                items={broad}
                explanations={explanations}
              />
            );
          })}
        </CollapsedGroup>
      )}

      {foreignItems.length > 0 && originCountry && (
        <CollapsedGroup
          title={`Меры других стран (${foreignItems.length}): ${foreignNames.join(', ')}`}
          hint={`Действуют только для товаров из указанных стран и не относятся к стране происхождения — ${originCountry.name}.`}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {foreignItems.map((item) => (
              <RegulatoryCard key={item.id} item={item} explanations={explanations} />
            ))}
          </div>
        </CollapsedGroup>
      )}
    </div>
  );
}

/** Свёрнутая по умолчанию группа маловероятно применимых записей. */
function CollapsedGroup({
  title,
  hint,
  children,
}: {
  title: string;
  hint: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div
      style={{
        marginTop: 14,
        border: '1px dashed var(--border-strong)',
        borderRadius: 8,
        padding: '10px 14px',
      }}
    >
      <button
        onClick={() => setOpen((v) => !v)}
        style={{
          display: 'flex',
          alignItems: 'baseline',
          gap: 8,
          width: '100%',
          textAlign: 'left',
          background: 'none',
          border: 'none',
          padding: 0,
          cursor: 'pointer',
        }}
      >
        <span style={{ fontSize: 11, color: 'var(--text-subtle)', flexShrink: 0 }}>
          {open ? '▾' : '▸'}
        </span>
        <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-muted)' }}>{title}</span>
      </button>
      <div style={{ margin: '2px 0 0 19px', fontSize: 12, color: 'var(--text-subtle)' }}>{hint}</div>
      {open && <div style={{ marginTop: 4 }}>{children}</div>}
    </div>
  );
}

function RegulatorySubSection({
  title,
  description,
  items,
  explanations,
}: {
  title: string;
  description?: string;
  items: RegulatoryItem[];
  explanations: RegulatoryExplanationsState;
}) {
  return (
    <div style={{ marginTop: 14 }}>
      <h4 style={{ margin: '0 0 4px', fontSize: 14 }}>
        {title}{' '}
        <span style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 'normal' }}>({items.length})</span>
      </h4>
      {description && (
        <p style={{ margin: '0 0 8px', color: 'var(--text-subtle)', fontSize: 12 }}>{description}</p>
      )}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {items.map((item) => (
          <RegulatoryCard key={item.id} item={item} explanations={explanations} />
        ))}
      </div>
    </div>
  );
}

/** Компактный аккордеон одной меры: свёрнут в строку, детали — по клику. */
function RegulatoryCard({
  item,
  explanations,
}: {
  item: RegulatoryItem;
  explanations: RegulatoryExplanationsState;
}) {
  const [open, setOpen] = useState(false);
  const [showRaw, setShowRaw] = useState(false);
  const precision = PRECISION_BADGES[item.matchPrecision];
  const explanation = explanations.status === 'ready' ? explanations.data[item.id] ?? null : null;
  // AI-уточнения накладываются поверх детерминистических полей. nullable AI-поля не
  // затирают валидные значения парсера — берём только не-null/непустые.
  const display = {
    form: explanation?.form ?? item.form,
    regulation: explanation?.regulation ?? item.regulation,
    authority: explanation?.authority ?? item.authority,
    summary: explanation?.summary ?? item.summary,
  };
  const formLabel = FORM_LABELS[display.form];

  return (
    <div
      style={{
        border: '1px solid var(--border)',
        borderRadius: 6,
        backgroundColor: '#ffffff',
      }}
    >
      <div
        onClick={() => setOpen((v) => !v)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '7px 12px',
          cursor: 'pointer',
        }}
      >
        <span style={{ fontSize: 10, color: 'var(--text-subtle)', flexShrink: 0 }}>
          {open ? '▾' : '▸'}
        </span>
        <span
          style={{
            flex: 1,
            minWidth: 0,
            fontSize: 13,
            fontWeight: 500,
            whiteSpace: open ? 'normal' : 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
          title={open ? undefined : item.title}
        >
          {item.title}
        </span>
        {item.countryName && (
          <span style={{ fontSize: 11, color: 'var(--text-muted)', whiteSpace: 'nowrap', flexShrink: 0 }}>
            {item.countryName}
          </span>
        )}
        <Badge
          label={precision.label}
          bg={precision.bg}
          fg={precision.fg}
          tooltip={precision.tooltip}
        />
      </div>

      {open && (
        <div style={{ padding: '0 12px 10px 30px' }}>
          {display.regulation && display.form !== 'unknown' && (
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 6 }}>
              Форма: {formLabel}
            </div>
          )}
          <div
            style={{
              fontSize: 13,
              color: 'var(--text)',
              lineHeight: 1.5,
              whiteSpace: 'pre-wrap',
            }}
          >
            {display.summary}
            {explanation && (
              <span
                title="Сводка получена AI-моделью на основе текста NOTE из справочника TKS"
                style={{
                  marginLeft: 8,
                  fontSize: 10,
                  padding: '1px 6px',
                  borderRadius: 4,
                  backgroundColor: 'var(--violet-soft)',
                  color: 'var(--violet-strong)',
                  verticalAlign: 'middle',
                  cursor: 'help',
                }}
              >
                AI
              </span>
            )}
          </div>

          <div
            style={{
              marginTop: 8,
              display: 'flex',
              flexWrap: 'wrap',
              gap: '4px 18px',
              fontSize: 12,
              color: 'var(--text-muted)',
            }}
          >
            {display.authority && (
              <span>
                <span style={{ color: 'var(--text-subtle)' }}>Регулятор:</span> {display.authority}
              </span>
            )}
            {item.documentRef && (
              <span>
                <span style={{ color: 'var(--text-subtle)' }}>Документ:</span> N {item.documentRef.number}
                {item.documentRef.date && ` от ${fmtIsoDate(item.documentRef.date)}`}
              </span>
            )}
            {(item.validFrom || item.validTo) && (
              <span>
                <span style={{ color: 'var(--text-subtle)' }}>Период:</span>{' '}
                {fmtPeriod(item.validFrom, item.validTo)}
              </span>
            )}
            <span>
              <span style={{ color: 'var(--text-subtle)' }}>Код в TKS:</span> {item.codeRange.min}
              {item.codeRange.max ? ` … ${item.codeRange.max}` : ''}
            </span>
            {item.countryName && (
              <span>
                <span style={{ color: 'var(--text-subtle)' }}>Страна:</span> {item.countryName}{' '}
                <code style={{ color: 'var(--text-subtle)' }}>{item.countryCode}</code>
              </span>
            )}
          </div>

          <button
            onClick={() => setShowRaw((v) => !v)}
            style={{
              marginTop: 8,
              background: 'none',
              border: 'none',
              color: 'var(--accent)',
              padding: 0,
              cursor: 'pointer',
              fontSize: 12,
            }}
          >
            {showRaw ? 'Скрыть исходный текст' : 'Показать исходный текст'}
          </button>

          {showRaw && (
            <pre
              style={{
                marginTop: 8,
                padding: 12,
                backgroundColor: 'var(--bg-subtle)',
                border: '1px solid var(--border)',
                borderRadius: 4,
                fontSize: 12,
                color: 'var(--text)',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
                maxHeight: 320,
                overflowY: 'auto',
              }}
            >
              {item.rawNote || '—'}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}

function Badge({ label, bg, fg, tooltip }: { label: string; bg: string; fg: string; tooltip: string }) {
  return (
    <span
      title={tooltip}
      style={{
        backgroundColor: bg,
        color: fg,
        fontSize: 11,
        padding: '2px 8px',
        borderRadius: 999,
        whiteSpace: 'nowrap',
        flexShrink: 0,
        cursor: 'help',
      }}
    >
      {label}
    </span>
  );
}
