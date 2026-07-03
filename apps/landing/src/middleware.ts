import { NextResponse, type NextRequest } from 'next/server';

// Русский обслуживается на корне `/` без префикса. Внутренний rewrite на
// `/ru` — адрес в браузере остаётся `/` (никакого редиректа). Пути `/en` и
// `/zh` проходят как есть (middleware на них не срабатывает — см. matcher).
export function middleware(request: NextRequest) {
  const url = request.nextUrl.clone();
  url.pathname = '/ru';
  return NextResponse.rewrite(url);
}

export const config = {
  matcher: '/',
};
