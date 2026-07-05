import { COMPANY_THEMES, type CompanyTheme } from '@/lib/types';
import { headers } from 'next/headers';

/** Темы должны совпадать с блоками `:root[data-theme="…"]` в globals.css. */
const DEFAULT_THEME: CompanyTheme = 'default';

const API_URL = process.env.API_URL || 'http://localhost:3001/api';

function normalizeTheme(value: unknown): CompanyTheme {
  return typeof value === 'string' && (COMPANY_THEMES as readonly string[]).includes(value)
    ? (value as CompanyTheme)
    : DEFAULT_THEME;
}

/**
 * Резолвит тему тенанта по домену входящего запроса (серверно, в корневом layout). Дёргает
 * публичный `GET /tenant/theme` на бэке. Ответ кэшируется по URL (домен — ключ) на 60с, чтобы
 * не бить апстрим на каждый рендер: domain→theme меняется редко (только super_admin). Любой сбой
 * (нет БД/таймаут/неизвестный домен) → дефолтная тема: темизация не должна ронять рендер админки.
 */
export async function resolveTheme(): Promise<CompanyTheme> {
  try {
    const h = await headers();
    const host = h.get('x-forwarded-host') ?? h.get('host') ?? '';
    const domain = host.split(',')[0].trim().split(':')[0]; // первый хост, без порта
    if (!domain) return DEFAULT_THEME;
    const res = await fetch(`${API_URL}/tenant/theme?domain=${encodeURIComponent(domain)}`, {
      next: { revalidate: 60 },
      signal: AbortSignal.timeout(2000),
    });
    if (!res.ok) return DEFAULT_THEME;
    const data = (await res.json()) as { theme?: unknown };
    return normalizeTheme(data.theme);
  } catch {
    return DEFAULT_THEME;
  }
}
