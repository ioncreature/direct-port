/** Бренд direct_port — марка и вордмарк, идентичные лендингу (apps/landing).
 *  Марка повторяет apps/landing/src/app/icon.svg, вордмарк — .wm лендинга:
 *  моноширинный direct_port с цветными сегментами. */

const MARK_INK = '#0B2536';
const MARK_PAPER = '#F6F4EF';
const MARK_ORANGE = '#E8622A';

export function BrandMark({ size = 30 }: { size?: number }) {
  return (
    <svg
      viewBox="0 0 64 64"
      width={size}
      height={size}
      aria-hidden
      style={{ display: 'block', flexShrink: 0, borderRadius: size * 0.25, boxShadow: 'var(--shadow-sm)' }}
    >
      <rect width="64" height="64" rx="14" fill={MARK_INK} />
      <circle cx="24.5" cy="37" r="9.5" fill="none" stroke={MARK_PAPER} strokeWidth="7" />
      <rect x="33" y="14" width="7" height="36" rx="3.5" fill={MARK_PAPER} />
      <rect x="47" y="14" width="9" height="36" rx="2.5" fill={MARK_ORANGE} />
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
