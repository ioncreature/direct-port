import { btnOutline } from '@/lib/table-styles';

interface PagerProps {
  page: number;
  total: number;
  limit: number;
  onPageChange: (page: number) => void;
}

export function Pager({ page, total, limit, onPageChange }: PagerProps) {
  const totalPages = Math.max(1, Math.ceil(total / limit));

  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginTop: 16,
        fontSize: 14,
      }}
    >
      <span style={{ color: 'var(--text-muted)' }}>Всего: {total}</span>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <button onClick={() => onPageChange(page - 1)} disabled={page <= 1} style={btnOutline}>
          ← Пред
        </button>
        <span>
          {page} из {totalPages}
        </span>
        <button
          onClick={() => onPageChange(page + 1)}
          disabled={page >= totalPages}
          style={btnOutline}
        >
          След →
        </button>
      </div>
    </div>
  );
}
