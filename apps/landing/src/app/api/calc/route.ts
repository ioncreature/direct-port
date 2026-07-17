import { NextResponse, type NextRequest } from 'next/server';

// Прокси мини-калькулятора: браузер ходит same-origin в /api/calc, лендинг
// форвардит в публичный endpoint api (rate-limit по IP и валидация — на стороне api).
// CALC_API_URL — внутренний адрес api (в k8s — сервис api, локально — localhost:3001).
const API_URL = process.env.CALC_API_URL || 'http://localhost:3001/api';

export async function POST(request: NextRequest) {
  // cf-connecting-ip ставит Cloudflare — пробрасываем его до api, чтобы rate-limit
  // считался по реальному посетителю, а не по IP пода лендинга.
  const clientIp = request.headers.get('cf-connecting-ip');

  try {
    // Тело форвардим как есть — валидацию JSON выполняет ValidationPipe api (400).
    const res = await fetch(`${API_URL}/public/calculator/estimate`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(clientIp ? { 'cf-connecting-ip': clientIp } : {}),
      },
      body: await request.text(),
      cache: 'no-store',
      // Поиск TKS + перевод запроса могут занять несколько секунд на холодном кэше.
      signal: AbortSignal.timeout(30_000),
    });
    return new NextResponse(res.body, {
      status: res.status,
      headers: { 'content-type': res.headers.get('content-type') ?? 'application/json' },
    });
  } catch {
    return NextResponse.json({ message: 'Service unavailable' }, { status: 503 });
  }
}
