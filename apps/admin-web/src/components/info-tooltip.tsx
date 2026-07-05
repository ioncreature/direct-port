'use client';

import { useState } from 'react';

/**
 * Маленькая иконка «?» рядом с подписью поля. По наведению/фокусу показывает
 * короткую подсказку во всплывающем поповере. Для подробностей — страница /reference.
 */
export function InfoTooltip({ text, label = 'Справка' }: { text: string; label?: string }) {
  const [open, setOpen] = useState(false);

  return (
    <span style={{ position: 'relative', display: 'inline-flex', verticalAlign: 'middle' }}>
      <button
        type="button"
        aria-label={label}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onClick={(e) => {
          e.preventDefault();
          setOpen((v) => !v);
        }}
        style={{
          width: 16,
          height: 16,
          borderRadius: '50%',
          border: '1px solid var(--border-strong)',
          background: 'var(--surface)',
          color: 'var(--text-muted)',
          fontSize: 11,
          fontWeight: 700,
          lineHeight: 1,
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: 'help',
          padding: 0,
          flexShrink: 0,
        }}
      >
        ?
      </button>
      {open && (
        <span
          role="tooltip"
          style={{
            position: 'absolute',
            bottom: 'calc(100% + 8px)',
            left: 0,
            zIndex: 100,
            width: 260,
            padding: '10px 12px',
            background: 'var(--surface)',
            border: '1px solid var(--border-strong)',
            borderRadius: 8,
            boxShadow: '0 6px 20px rgba(0, 0, 0, 0.15)',
            fontSize: 12,
            fontWeight: 400,
            lineHeight: 1.45,
            color: 'var(--text-muted)',
            whiteSpace: 'normal',
            textTransform: 'none',
            letterSpacing: 'normal',
            pointerEvents: 'none',
          }}
        >
          {text}
        </span>
      )}
    </span>
  );
}
