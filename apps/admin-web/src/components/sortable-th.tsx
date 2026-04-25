import { thSortable } from '@/lib/table-styles';
import type { SortOrder } from '@/lib/types';
import type { CSSProperties } from 'react';

interface SortableThProps {
  field: string;
  label: string;
  sortBy: string;
  sortOrder: SortOrder;
  onToggle: (field: string) => void;
  style?: CSSProperties;
}

export function SortableTh({ field, label, sortBy, sortOrder, onToggle, style }: SortableThProps) {
  const arrow = sortBy !== field ? '' : sortOrder === 'ASC' ? ' ▲' : ' ▼';
  return (
    <th style={style ? { ...thSortable, ...style } : thSortable} onClick={() => onToggle(field)}>
      {label}
      {arrow}
    </th>
  );
}
