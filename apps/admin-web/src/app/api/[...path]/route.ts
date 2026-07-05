import type { NextRequest } from 'next/server';
import { createLogger, formatFetchError } from '@/lib/logger';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const API_URL = process.env.API_URL || 'http://localhost:3001/api';

const logger = createLogger().child({ component: 'proxy' });

const HOP_BY_HOP_REQUEST_HEADERS = ['host', 'connection', 'content-length'];
const HOP_BY_HOP_RESPONSE_HEADERS = [
  'content-encoding',
  'content-length',
  'transfer-encoding',
  'connection',
];

async function proxy(req: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  const { path } = await context.params;
  const pathname = `/${path.join('/')}`;
  const targetUrl = `${API_URL}${pathname}${req.nextUrl.search}`;
  const method = req.method;
  const start = performance.now();

  const headers = new Headers(req.headers);
  // Исходный хост запроса — для тенант-гейта логина на бэке (x-tenant-host). Берём из
  // x-forwarded-host (за реверс-прокси) либо Host; фиксируем до вырезания hop-by-hop host.
  const tenantHost = (headers.get('x-forwarded-host') ?? headers.get('host') ?? '')
    .split(',')[0]
    .trim();
  for (const h of HOP_BY_HOP_REQUEST_HEADERS) headers.delete(h);
  if (tenantHost) headers.set('x-tenant-host', tenantHost);

  const init: RequestInit & { duplex?: 'half' } = {
    method,
    headers,
    redirect: 'manual',
  };

  if (method !== 'GET' && method !== 'HEAD') {
    init.body = req.body;
    init.duplex = 'half';
  }

  try {
    const res = await fetch(targetUrl, init);
    const responseTimeMs = Math.round(performance.now() - start);

    const logData = {
      http: { method, url: pathname, statusCode: res.status },
      responseTimeMs,
    };

    if (res.status >= 500) {
      logger.error(logData, `${method} ${pathname} -> ${res.status}`);
    } else if (res.status >= 400) {
      logger.warn(logData, `${method} ${pathname} -> ${res.status}`);
    } else {
      logger.debug(logData, `${method} ${pathname} -> ${res.status}`);
    }

    const responseHeaders = new Headers(res.headers);
    for (const h of HOP_BY_HOP_RESPONSE_HEADERS) responseHeaders.delete(h);

    return new Response(res.body, {
      status: res.status,
      statusText: res.statusText,
      headers: responseHeaders,
    });
  } catch (err) {
    const responseTimeMs = Math.round(performance.now() - start);
    const errorSummary = formatFetchError(err);

    logger.error(
      {
        http: { method, url: pathname },
        targetUrl,
        responseTimeMs,
        err: errorSummary,
      },
      `${method} ${pathname} -> FETCH_FAILED`,
    );

    return new Response(JSON.stringify({ error: 'Backend unavailable' }), {
      status: 502,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

export {
  proxy as DELETE,
  proxy as GET,
  proxy as HEAD,
  proxy as OPTIONS,
  proxy as PATCH,
  proxy as POST,
  proxy as PUT,
};
