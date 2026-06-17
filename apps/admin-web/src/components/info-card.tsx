import { cardSurface } from '@/lib/table-styles';

export function InfoCard({
  label,
  value,
  color,
}: {
  label: string;
  value: string;
  color?: string;
}) {
  return (
    <div style={{ ...cardSurface, padding: 16 }}>
      <div
        style={{
          fontSize: 11,
          fontWeight: 600,
          textTransform: 'uppercase',
          letterSpacing: '0.04em',
          color: 'var(--text-muted)',
          marginBottom: 6,
        }}
      >
        {label}
      </div>
      <div style={{ fontSize: 16, fontWeight: 600, color: color || 'var(--text)' }}>{value}</div>
    </div>
  );
}
