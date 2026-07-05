export const th: React.CSSProperties = {
  textAlign: 'left',
  padding: '10px 12px',
  fontFamily: 'var(--font-mono)',
  fontSize: 11,
  fontWeight: 600,
  color: 'var(--text-muted)',
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
  borderBottom: '1px solid var(--border-strong)',
  whiteSpace: 'nowrap',
};
export const thR: React.CSSProperties = { ...th, textAlign: 'right' };
export const thC: React.CSSProperties = { ...th, textAlign: 'center' };
export const thSortable: React.CSSProperties = { ...th, cursor: 'pointer', userSelect: 'none' };

export const td: React.CSSProperties = {
  padding: '11px 12px',
  borderBottom: '1px solid var(--border-subtle)',
  color: 'var(--text)',
};
export const tdR: React.CSSProperties = { ...td, textAlign: 'right' };
export const tdC: React.CSSProperties = { ...td, textAlign: 'center' };
export const tdEmpty: React.CSSProperties = {
  ...td,
  textAlign: 'center',
  color: 'var(--text-subtle)',
  padding: '32px 12px',
};

export const btnOutline: React.CSSProperties = {
  padding: '7px 14px',
  cursor: 'pointer',
  borderRadius: 'var(--radius-sm)',
  border: '1px solid var(--border)',
  background: 'var(--surface)',
  color: 'var(--text)',
  fontSize: 13,
  fontWeight: 500,
  boxShadow: 'var(--shadow-xs)',
};
export const btnLink: React.CSSProperties = {
  border: 'none',
  background: 'none',
  padding: 0,
  font: 'inherit',
  fontWeight: 500,
  color: 'var(--accent)',
  cursor: 'pointer',
};
/** Главное действие — оранжевый CTA, как кнопки лендинга. */
export const btnPrimary: React.CSSProperties = {
  padding: '8px 16px',
  background: 'var(--orange)',
  color: '#fff',
  border: 'none',
  borderRadius: 'var(--radius-sm)',
  fontSize: 14,
  fontWeight: 600,
  cursor: 'pointer',
  boxShadow: 'var(--shadow-sm)',
};
export const btnSuccess: React.CSSProperties = {
  ...btnPrimary,
  background: 'var(--success)',
};
export const btnWarning: React.CSSProperties = {
  ...btnPrimary,
  background: 'var(--warning)',
};
export const btnDanger: React.CSSProperties = {
  ...btnPrimary,
  background: 'var(--danger)',
};
export const btnDangerOutline: React.CSSProperties = {
  padding: '8px 16px',
  background: 'var(--surface)',
  color: 'var(--danger)',
  border: '1px solid var(--danger)',
  borderRadius: 'var(--radius-sm)',
  fontSize: 14,
  fontWeight: 600,
  cursor: 'pointer',
};

/** Высота области баров у страничных бар-чартов (дашборд, /ai-costs). */
export const CHART_HEIGHT_PX = 120;

/** Базовая «поверхность-карточка»: фон, граница, радиус, мягкая тень.
 *  Спред + переопределение padding/height по месту. */
export const cardSurface: React.CSSProperties = {
  background: 'var(--surface)',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius)',
  boxShadow: 'var(--shadow-sm)',
};

/** Primary-кнопка в виде ссылки (Link «Загрузить» / «Создать»). */
export const primaryLink: React.CSSProperties = {
  ...btnPrimary,
  display: 'inline-block',
  textDecoration: 'none',
};

/** Pill-бейдж «успех» (например, «Клиент»). Padding/fontSize задаются по месту спредом. */
export const successBadge: React.CSSProperties = {
  display: 'inline-block',
  borderRadius: 'var(--radius-pill)',
  background: 'var(--success)',
  color: '#fff',
  fontWeight: 600,
};

/** Pill-чип фильтра (списки документов/пользователей).
 *  Активный — ink-фон, как сегментированный переключатель лендинга. */
export function filterChip(active: boolean): React.CSSProperties {
  return {
    padding: '5px 13px',
    borderRadius: 'var(--radius-pill)',
    cursor: 'pointer',
    fontSize: 13,
    fontWeight: 500,
    border: `1px solid ${active ? 'var(--ink)' : 'var(--border)'}`,
    background: active ? 'var(--ink)' : 'var(--surface)',
    color: active ? '#fff' : 'var(--text-muted)',
    boxShadow: active ? 'var(--shadow-xs)' : 'none',
  };
}
