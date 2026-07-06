export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Health-эндпоинт для k8s liveness/readiness проб. Route Handler — НЕ проходит через корневой
 * layout, поэтому строгий режим тенанта (UNKNOWN_TENANT_BEHAVIOR=404) его не 404-ит, даже когда
 * проба бьёт по pod IP (домен неизвестен). Всегда 200, пока Node-процесс жив.
 */
export function GET(): Response {
  return new Response('ok', {
    status: 200,
    headers: { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' },
  });
}
