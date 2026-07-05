import {
  INCOTERMS_INFO,
  incotermsCalcImpact,
  incotermsFreightConsistency,
  type IncotermsTone,
} from '@/lib/incoterms';
import type { Incoterms } from '@/lib/types';

const TONE_STYLE: Record<IncotermsTone, { bg: string; bar: string; icon: string; iconColor: string }> = {
  ok: { bg: 'var(--success-soft)', bar: 'var(--success)', icon: '✓', iconColor: 'var(--success-strong)' },
  warn: { bg: 'var(--warning-soft)', bar: 'var(--warning)', icon: '⚠', iconColor: 'var(--warning-strong)' },
  info: { bg: 'var(--accent-soft)', bar: 'var(--accent)', icon: 'ⓘ', iconColor: 'var(--accent-soft-text)' },
};

/**
 * Карточка-справка по выбранному базису Incoterms. Показывается под формой пересчёта
 * (или загрузки) при выбранном значении: расшифровка термина, влияние на расчёт и
 * живая проверка согласованности с текущим значением фрахта.
 */
export function IncotermsHelp({ term, hasFreight }: { term: Incoterms; hasFreight: boolean }) {
  const info = INCOTERMS_INFO[term];
  const consistency = incotermsFreightConsistency(term, hasFreight);
  const tone = TONE_STYLE[consistency.tone];

  return (
    <div
      style={{
        marginTop: 14,
        padding: '12px 14px',
        border: '1px solid var(--border)',
        borderRadius: 8,
        background: 'var(--surface)',
        fontSize: 13,
        lineHeight: 1.5,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap', marginBottom: 6 }}>
        <span style={{ fontWeight: 600, fontSize: 14 }}>
          {term} — {info.nameRu}
        </span>
        <span style={{ color: 'var(--text-subtle)' }}>{info.nameEn}</span>
        <span
          style={{
            fontSize: 11,
            fontWeight: 500,
            padding: '1px 8px',
            borderRadius: 999,
            background: 'var(--accent-soft)',
            color: 'var(--accent-soft-text)',
          }}
        >
          {info.summary}
        </span>
        {info.seaOnly && (
          <span
            style={{
              fontSize: 11,
              fontWeight: 500,
              padding: '1px 8px',
              borderRadius: 999,
              background: 'var(--surface-hover)',
              color: 'var(--text-muted)',
              border: '1px solid var(--border)',
            }}
          >
            только водный транспорт
          </span>
        )}
      </div>

      <p style={{ margin: '0 0 8px', color: 'var(--text-muted)' }}>{info.transfer}</p>

      <div style={{ marginBottom: 8 }}>
        <span style={{ fontWeight: 600 }}>Как влияет на расчёт. </span>
        <span style={{ color: 'var(--text-muted)' }}>{incotermsCalcImpact(term)}</span>
      </div>

      <div
        style={{
          display: 'flex',
          gap: 8,
          padding: '8px 10px',
          borderRadius: 6,
          background: tone.bg,
          border: '1px solid var(--border-subtle)',
          borderLeft: `3px solid ${tone.bar}`,
        }}
      >
        <span aria-hidden style={{ color: tone.iconColor, fontWeight: 700, lineHeight: 1.5 }}>
          {tone.icon}
        </span>
        <span>{consistency.text}</span>
      </div>

      <p style={{ margin: '8px 0 0', fontSize: 12, color: 'var(--text-subtle)' }}>
        Значение Инкотермс само по себе сумму не меняет — оно попадает в графу 20 ДТ и включает
        проверку структуры таможенной стоимости.
      </p>
    </div>
  );
}
