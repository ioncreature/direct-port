/** Бренд direct_port — марка и вордмарк, идентичные лендингу (apps/landing).
 *  Марка повторяет apps/landing/src/app/icon.svg, вордмарк — .wm лендинга:
 *  моноширинный direct_port с цветными сегментами.
 *
 *  Цвета марки берутся из CSS-переменных (--brand-mark-*), чтобы тема тенанта могла их
 *  перекрасить. var() в SVG резолвится только через style, а не через атрибут fill/stroke. */

export function BrandMark({ size = 30 }: { size?: number }) {
  return (
    <svg
      viewBox="0 0 64 64"
      width={size}
      height={size}
      aria-hidden
      style={{ display: 'block', flexShrink: 0, borderRadius: size * 0.25, boxShadow: 'var(--shadow-sm)' }}
    >
      <rect width="64" height="64" rx="14" style={{ fill: 'var(--brand-mark-ink)' }} />
      <circle
        cx="24.5"
        cy="37"
        r="9.5"
        fill="none"
        strokeWidth="7"
        style={{ stroke: 'var(--brand-mark-paper)' }}
      />
      <rect x="33" y="14" width="7" height="36" rx="3.5" style={{ fill: 'var(--brand-mark-paper)' }} />
      <rect x="47" y="14" width="9" height="36" rx="2.5" style={{ fill: 'var(--brand-mark-orange)' }} />
    </svg>
  );
}

export function Wordmark({ fontSize = 17 }: { fontSize?: number }) {
  return (
    <span
      style={{
        fontFamily: 'var(--font-mono)',
        fontWeight: 600,
        fontSize,
        letterSpacing: '-0.02em',
        whiteSpace: 'nowrap',
      }}
    >
      <span style={{ color: 'var(--ink)' }}>direct</span>
      <span style={{ color: 'var(--orange)' }}>_</span>
      <span style={{ color: 'var(--petrol)' }}>port</span>
    </span>
  );
}
