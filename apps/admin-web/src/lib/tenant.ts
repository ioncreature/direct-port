import { COMPANY_THEMES, type CompanyTheme } from '@/lib/types';
import { headers } from 'next/headers';

/** Темы должны совпадать с блоками `:root[data-theme="…"]` в globals.css. */
const DEFAULT_THEME: CompanyTheme = 'default';

const API_URL = process.env.API_URL || 'http://localhost:3001/api';

export interface TenantBranding {
  theme: CompanyTheme;
  /** URL логотипа тенанта для <img> (через прокси admin-web); null — показываем дефолтную марку. */
  logoUrl: string | null;
}

function normalizeTheme(value: unknown): CompanyTheme {
  return typeof value === 'string' && (COMPANY_THEMES as readonly string[]).includes(value)
    ? (value as CompanyTheme)
    : DEFAULT_THEME;
}

/**
 * Резолвит брендинг тенанта по домену входящего запроса (серверно, в корневом layout): тему и URL
 * логотипа. Дёргает публичный `GET /tenant/theme` на бэке. Ответ кэшируется по URL (домен — ключ)
 * на 60с, чтобы не бить апстрим на каждый рендер. Любой сбой (нет БД/таймаут/неизвестный домен) →
 * дефолтная тема без логотипа: брендинг не должен ронять рендер админки.
 */
export async function resolveBranding(): Promise<TenantBranding> {
  try {
    const h = await headers();
    const host = h.get('x-forwarded-host') ?? h.get('host') ?? '';
    const domain = host.split(',')[0].trim().split(':')[0]; // первый хост, без порта
    if (!domain) return { theme: DEFAULT_THEME, logoUrl: null };
    const res = await fetch(`${API_URL}/tenant/theme?domain=${encodeURIComponent(domain)}`, {
      next: { revalidate: 60 },
      signal: AbortSignal.timeout(2000),
    });
    if (!res.ok) return { theme: DEFAULT_THEME, logoUrl: null };
    const data = (await res.json()) as { theme?: unknown; logoVersion?: unknown };
    const logoVersion = typeof data.logoVersion === 'string' ? data.logoVersion : null;
    return {
      theme: normalizeTheme(data.theme),
      // Картинку тянем через прокси admin-web (/api → api), компанию бэк резолвит по x-tenant-host.
      // ?v=<hash> — cache-busting: смена логотипа даёт новый URL, immutable-кэш не отдаёт старый.
      logoUrl: logoVersion ? `/api/tenant/logo?v=${encodeURIComponent(logoVersion)}` : null,
    };
  } catch {
    return { theme: DEFAULT_THEME, logoUrl: null };
  }
}
