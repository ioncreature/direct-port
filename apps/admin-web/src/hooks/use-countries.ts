'use client';

import api from '@/lib/api';
import type { Country } from '@/lib/types';
import { useEffect, useState } from 'react';

// Модульный кеш: один список стран на всю жизнь вкладки. Справочник OKSMT меняется редко,
// а страницу документа могут открывать много раз — новый GET на каждый mount был бы лишним.
let cache: Country[] | null = null;
let pending: Promise<Country[]> | null = null;

async function loadCountries(): Promise<Country[]> {
  if (cache) return cache;
  if (!pending) {
    pending = api
      .get<Country[]>('/countries')
      .then(({ data }) => {
        cache = data;
        return data;
      })
      .catch(() => {
        cache = [];
        return [];
      })
      .finally(() => {
        pending = null;
      });
  }
  return pending;
}

export function useCountries() {
  const [countries, setCountries] = useState<Country[]>(() => cache ?? []);
  const [loading, setLoading] = useState(() => cache === null);

  useEffect(() => {
    if (cache) return;
    let cancelled = false;
    loadCountries().then((list) => {
      if (!cancelled) {
        setCountries(list);
        setLoading(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return { countries, loading };
}
