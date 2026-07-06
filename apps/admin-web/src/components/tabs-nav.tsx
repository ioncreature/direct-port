'use client';

/** Горизонтальная навигация по вкладкам (подчёркивание активной). */
export function TabsNav<T extends string>({
  tabs,
  active,
  onChange,
  labels,
}: {
  tabs: readonly T[];
  active: T;
  onChange: (tab: T) => void;
  labels: Record<T, string>;
}) {
  return (
    <div
      style={{
        display: 'flex',
        gap: 4,
        borderBottom: '1px solid var(--border)',
        marginBottom: 20,
        // На узких экранах вкладки не переносятся и не сжимаются, а
        // прокручиваются по горизонтали в один ряд (как таб-бар на мобильных).
        overflowX: 'auto',
        maxWidth: '100%',
      }}
    >
      {tabs.map((tab) => {
        const isActive = active === tab;
        return (
          <button
            key={tab}
            type="button"
            onClick={() => onChange(tab)}
            style={{
              padding: '10px 18px',
              background: 'none',
              border: 'none',
              borderBottom: isActive ? '2px solid var(--accent)' : '2px solid transparent',
              marginBottom: -1,
              cursor: 'pointer',
              fontSize: 14,
              fontWeight: isActive ? 600 : 400,
              color: isActive ? 'var(--accent)' : 'var(--text-muted)',
              flexShrink: 0,
              whiteSpace: 'nowrap',
            }}
          >
            {labels[tab]}
          </button>
        );
      })}
    </div>
  );
}
