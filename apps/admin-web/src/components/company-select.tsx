'use client';

import api from '@/lib/api';
import type { Company, PaginatedResponse } from '@/lib/types';
import { useEffect, useState } from 'react';

/**
 * Выпадающий список компаний — только для super_admin (фильтр данных по компании
 * или выбор компании в формах). value='' → значение `allLabel` («Все компании»).
 * Сам загружает список компаний с /companies.
 */
export function CompanySelect({
  value,
  onChange,
  allLabel = 'Все компании',
  style,
}: {
  value: string;
  onChange: (companyId: string) => void;
  allLabel?: string;
  style?: React.CSSProperties;
}) {
  const [companies, setCompanies] = useState<Company[]>([]);

  useEffect(() => {
    api
      .get<PaginatedResponse<Company>>('/companies', {
        params: { limit: 100, sortBy: 'name', sortOrder: 'ASC' },
      })
      .then(({ data }) => setCompanies(data.data))
      .catch(() => setCompanies([]));
  }, []);

  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      // maxWidth/minWidth: длинное имя компании не должно раздувать select и
      // ломать раскладку на узких экранах (как у селектов страны/Инкотермс).
      style={{ padding: 8, boxSizing: 'border-box', maxWidth: '100%', minWidth: 0, ...style }}
    >
      <option value="">{allLabel}</option>
      {companies.map((c) => (
        <option key={c.id} value={c.id}>
          {c.name}
        </option>
      ))}
    </select>
  );
}
