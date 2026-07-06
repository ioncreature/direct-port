import { COMPANY_THEMES, type CompanyTheme } from '@/lib/types';
import { headers } from 'next/headers';

/** Темы должны совпадать с блоками `:root[data-theme="…"]` в globals.css. */
const DEFAULT_THEME: CompanyTheme = 'default';

const API_URL = process.env.API_URL || 'http://localhost:3001/api';

/**
 * Строгий режим тенанта. Если `UNKNOWN_TENANT_BEHAVIOR=404` — запросы с домена, не привязанного ни
 * к одной компании, получают 404 (layout и прокси /api), а не молчаливый fallback на компанию по
 * умолчанию. Не выставлена → админка работает как раньше (неизвестный домен = дефолтная компания).
 */
export const STRICT_UNKNOWN_TENANT = process.env.UNKNOWN_TENANT_BEHAVIOR === '404';

export interface TenantBranding {
  theme: CompanyTheme;
  /** URL логотипа тенанта для <img> (через прокси admin-web); null — показываем дефолтную марку. */
  logoUrl: string | null;
  /** URL favicon тенанта для <link rel="icon">; null — дефолтный favicon DirectPort. */
  faviconUrl: string | null;
  /** Домен привязан к какой-то компании? false — в строгом режиме layout отдаёт 404. */
  known: boolean;
}

interface TenantInfo {
  theme: CompanyTheme;
  logoVersion: string | null;
  faviconVersion: string | null;
  known: boolean;
}

function normalizeTheme(value: unknown): CompanyTheme {
  return typeof value === 'string' && (COMPANY_THEMES as readonly string[]).includes(value)
    ? (value as CompanyTheme)
    : DEFAULT_THEME;
}

/** Нормализует Host к домену: первый из списка, trim, lowercase, без порта. */
export function domainFromHost(host: string | null | undefined): string {
  return (host ?? '').split(',')[0].trim().split(':')[0].toLowerCase();
}

const TENANT_TTL_MS = 60_000;
const TENANT_CACHE_MAX = 1000;
const tenantCache = new Map<string, { info: TenantInfo; exp: number }>();

// Дефолт при пустом домене / сбое резолва (fail-open): дефолтная тема, без ассетов, known=true —
// ни темизация, ни строгий гейт не должны ронять админку на блипе API.
const DEFAULT_TENANT_INFO: TenantInfo = {
  theme: DEFAULT_THEME,
  logoVersion: null,
  faviconVersion: null,
  known: true,
};

/**
 * Резолвит тенанта по домену через публичный `GET /tenant/theme` (тема, версия лого, флаг known).
 * Кэш в памяти 60с по домену — общий для layout (тема) и прокси (строгий гейт), чтобы не бить API
 * на каждый запрос/ассет. Любой сбой резолва (нет БД/таймаут/неизвестный домен без БД) → дефолтная
 * тема и `known=true` (fail-open): ни темизация, ни строгий гейт не должны ронять админку на блипе.
 */
async function fetchTenant(domain: string): Promise<TenantInfo> {
  if (!domain) return DEFAULT_TENANT_INFO;
  const now = Date.now();
  const cached = tenantCache.get(domain);
  if (cached && cached.exp > now) return cached.info;
  try {
    const res = await fetch(`${API_URL}/tenant/theme?domain=${encodeURIComponent(domain)}`, {
      signal: AbortSignal.timeout(2000),
    });
    if (!res.ok) return DEFAULT_TENANT_INFO;
    const data = (await res.json()) as {
      theme?: unknown;
      logoVersion?: unknown;
      faviconVersion?: unknown;
      known?: unknown;
    };
    const info: TenantInfo = {
      theme: normalizeTheme(data.theme),
      logoVersion: typeof data.logoVersion === 'string' ? data.logoVersion : null,
      faviconVersion: typeof data.faviconVersion === 'string' ? data.faviconVersion : null,
      // Строгий гейт срабатывает ТОЛЬКО когда API явно сказал known=false. Сбой/таймаут → known=true.
      known: data.known === true,
    };
    // Сброс при переполнении — чтобы поток запросов с произвольными Host (строгий режим смотрит в
    // интернет) не растил кэш неограниченно; TTL всё равно 60с, событие редкое.
    if (tenantCache.size >= TENANT_CACHE_MAX) tenantCache.clear();
    tenantCache.set(domain, { info, exp: now + TENANT_TTL_MS });
    return info;
  } catch {
    return DEFAULT_TENANT_INFO;
  }
}

/**
 * Резолвит брендинг тенанта по домену входящего запроса (серверно, в корневом layout): тему, URL
 * логотипа и флаг known. Реальный домен тенанта Caddy кладёт в x-tenant-host (Host он переписывает
 * в admin.* ради роутинга Traefik, а x-forwarded-host Traefik перетирает) — читаем его первым;
 * фолбэк на x-forwarded-host/Host для dev/localhost.
 */
export async function resolveBranding(): Promise<TenantBranding> {
  const h = await headers();
  const domain = domainFromHost(
    h.get('x-tenant-host') ?? h.get('x-forwarded-host') ?? h.get('host'),
  );
  const t = await fetchTenant(domain);
  return {
    theme: t.theme,
    // Картинки тянем через прокси admin-web (/api → api), компанию бэк резолвит по x-tenant-host.
    // ?v=<hash> — cache-busting: смена ассета даёт новый URL, immutable-кэш не отдаёт старый.
    logoUrl: t.logoVersion ? `/api/tenant/logo?v=${encodeURIComponent(t.logoVersion)}` : null,
    faviconUrl: t.faviconVersion
      ? `/api/tenant/favicon?v=${encodeURIComponent(t.faviconVersion)}`
      : null,
    known: t.known,
  };
}

/** Известен ли домен (привязан к компании)? Для строгого гейта в прокси `/api/[...path]`. */
export async function isKnownTenant(domain: string): Promise<boolean> {
  return (await fetchTenant(domain)).known;
}
