/**
 * Нормализует адрес сайта в голый домен (lower-case, без протокола и www) —
 * ключ дедупликации лидов. Возвращает null для пустого/битого ввода.
 */
export function normalizeDomain(website: string | null | undefined): string | null {
  if (!website) return null;
  let raw = website.trim().toLowerCase();
  if (!raw) return null;
  if (!/^https?:\/\//.test(raw)) raw = `http://${raw}`;
  try {
    const host = new URL(raw).hostname.replace(/^www\./, '');
    return host || null;
  } catch {
    return null;
  }
}

/** Достраивает http-URL из домена/сайта для фетча. null — если домена нет. */
export function toFetchUrl(website: string | null | undefined): string | null {
  const domain = normalizeDomain(website);
  return domain ? `https://${domain}` : null;
}

/**
 * Грубое HTML→текст: вырезает script/style/комментарии и теги, раскрывает
 * частые HTML-сущности, схлопывает пробелы. Не идеальный парсер — задача в том,
 * чтобы отдать Claude осмысленный текст сайта дёшево (без headless-браузера).
 */
export function htmlToText(html: string): string {
  return html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, ' ')
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#?\w{1,8};/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Скачивает страницу обычным HTTP (без Claude web_fetch — дешевле и батчируемо),
 * приводит к тексту и обрезает до maxChars. Бросает при не-2xx / не-HTML / таймауте.
 */
export async function fetchPageText(
  url: string,
  opts: { maxChars?: number; timeoutMs?: number } = {},
): Promise<string> {
  const maxChars = opts.maxChars ?? 12_000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 15_000);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      redirect: 'follow',
      headers: {
        'User-Agent': 'DirectPortLeadBot/1.0 (+https://directport.ru)',
        Accept: 'text/html,application/xhtml+xml',
      },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const contentType = res.headers.get('content-type') ?? '';
    if (!contentType.includes('text/html') && !contentType.includes('text/plain')) {
      throw new Error(`не HTML (content-type: ${contentType || 'unknown'})`);
    }
    const html = await res.text();
    return htmlToText(html).slice(0, maxChars);
  } finally {
    clearTimeout(timer);
  }
}

/** Зажимает скор в [0,1]; не-число → null. null/undefined/'' трактуем как «не оценено» (≠ 0). */
export function clampScore(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.min(1, Math.max(0, n));
}

/** Чистит массив строк: trim, отбрасывает пустые, дедуп, кап по длине. */
export function cleanStringList(value: unknown, max = 20): string[] | null {
  if (!Array.isArray(value)) return null;
  const seen = new Set<string>();
  for (const item of value) {
    if (typeof item !== 'string') continue;
    const trimmed = item.trim();
    if (trimmed) seen.add(trimmed);
    if (seen.size >= max) break;
  }
  return seen.size > 0 ? [...seen] : null;
}
