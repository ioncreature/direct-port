'use client';

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
    bg: '#dcfce7',
    fg: '#166534',
    tooltip: 'Запись справочника привязана к этому 10-значному коду или его 8-значной подсубпозиции.',
  },
  narrow: {
    label: 'Применима к товарной позиции',
    bg: '#fef3c7',
    fg: '#92400e',
    tooltip:
      'Запись охватывает товарную позицию (4–7 знаков) — мера почти наверняка применима, но рекомендуется проверка по характеристикам.',
  },
  broad: {
    label: 'Возможно применимо',
    bg: '#fee2e2',
    fg: '#991b1b',
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

export function RegulatoryRequirementsSection({ report }: { report: RegulatoryReport }) {
  if (report.totalCount === 0) {
    return (
      <div style={{ marginTop: 24 }}>
        <h3 style={{ margin: '0 0 12px' }}>Разрешительные документы и ограничения</h3>
        <p style={{ color: '#666', fontSize: 14 }}>
          По справочнику TKS для этого кода нет разрешительных мер. Это не гарантирует отсутствие
          требований — окончательно подтверждайте у органа по сертификации или таможенного брокера.
        </p>
      </div>
    );
  }

  return (
    <div style={{ marginTop: 24 }}>
      <h3 style={{ margin: '0 0 6px' }}>
        Разрешительные документы и ограничения{' '}
        <span style={{ fontSize: 13, color: '#666', fontWeight: 'normal' }}>
          ({report.totalCount} записей)
        </span>
      </h3>
      <p style={{ color: '#666', fontSize: 13, margin: '0 0 14px' }}>
        Информация носит справочный характер на основе ТН ВЭД-справочника TKS. Окончательный
        список документов подтверждается в органе по сертификации / у таможенного брокера.
      </p>

      {SECTIONS.map((section) => {
        const items = report[section.key];
        if (items.length === 0) return null;
        return (
          <RegulatorySubSection
            key={section.key}
            title={section.title}
            description={section.description}
            items={items}
          />
        );
      })}
    </div>
  );
}

function RegulatorySubSection({
  title,
  description,
  items,
}: {
  title: string;
  description?: string;
  items: RegulatoryItem[];
}) {
  return (
    <div style={{ marginTop: 18 }}>
      <h4 style={{ margin: '0 0 4px', fontSize: 15 }}>
        {title}{' '}
        <span style={{ fontSize: 13, color: '#666', fontWeight: 'normal' }}>({items.length})</span>
      </h4>
      {description && (
        <p style={{ margin: '0 0 8px', color: '#888', fontSize: 12 }}>{description}</p>
      )}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {items.map((item, idx) => (
          <RegulatoryCard key={`${item.priznak}-${item.codeRange.min}-${idx}`} item={item} />
        ))}
      </div>
    </div>
  );
}

function RegulatoryCard({ item }: { item: RegulatoryItem }) {
  const [expanded, setExpanded] = useState(false);
  const precision = PRECISION_BADGES[item.matchPrecision];
  const formLabel = FORM_LABELS[item.form];

  return (
    <div
      style={{
        border: '1px solid #e5e7eb',
        borderRadius: 6,
        padding: '10px 14px',
        backgroundColor: '#ffffff',
      }}
    >
      <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <div style={{ flex: '1 1 320px', minWidth: 0 }}>
          <div style={{ fontWeight: 500, fontSize: 14 }}>{item.title}</div>
          {item.regulation && item.form !== 'unknown' && (
            <div style={{ fontSize: 12, color: '#666', marginTop: 2 }}>
              Форма: {formLabel}
            </div>
          )}
        </div>
        <Badge
          label={precision.label}
          bg={precision.bg}
          fg={precision.fg}
          tooltip={precision.tooltip}
        />
      </div>

      <div
        style={{
          marginTop: 8,
          fontSize: 13,
          color: '#374151',
          lineHeight: 1.5,
          whiteSpace: 'pre-wrap',
        }}
      >
        {item.summary}
      </div>

      <div
        style={{
          marginTop: 8,
          display: 'flex',
          flexWrap: 'wrap',
          gap: '4px 18px',
          fontSize: 12,
          color: '#6b7280',
        }}
      >
        {item.authority && (
          <span>
            <span style={{ color: '#9ca3af' }}>Регулятор:</span> {item.authority}
          </span>
        )}
        {item.documentRef && (
          <span>
            <span style={{ color: '#9ca3af' }}>Документ:</span> N {item.documentRef.number}
            {item.documentRef.date && ` от ${fmtIsoDate(item.documentRef.date)}`}
          </span>
        )}
        {(item.validFrom || item.validTo) && (
          <span>
            <span style={{ color: '#9ca3af' }}>Период:</span>{' '}
            {fmtPeriod(item.validFrom, item.validTo)}
          </span>
        )}
        <span>
          <span style={{ color: '#9ca3af' }}>Код в TKS:</span> {item.codeRange.min}
          {item.codeRange.max ? ` … ${item.codeRange.max}` : ''}
        </span>
        {item.countryName && (
          <span>
            <span style={{ color: '#9ca3af' }}>Страна:</span> {item.countryName}{' '}
            <code style={{ color: '#9ca3af' }}>{item.countryCode}</code>
          </span>
        )}
      </div>

      <button
        onClick={() => setExpanded((v) => !v)}
        style={{
          marginTop: 8,
          background: 'none',
          border: 'none',
          color: '#2563eb',
          padding: 0,
          cursor: 'pointer',
          fontSize: 12,
        }}
      >
        {expanded ? 'Скрыть исходный текст' : 'Показать исходный текст'}
      </button>

      {expanded && (
        <pre
          style={{
            marginTop: 8,
            padding: 12,
            backgroundColor: '#f9fafb',
            border: '1px solid #e5e7eb',
            borderRadius: 4,
            fontSize: 12,
            color: '#374151',
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
        cursor: 'help',
      }}
    >
      {label}
    </span>
  );
}

