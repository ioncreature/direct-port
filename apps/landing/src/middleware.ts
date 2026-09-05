import { NextResponse, type NextRequest } from 'next/server';

// Русский обслуживается на корне без префикса (`/`, `/calculator`, `/compare`). Внутренний
// rewrite на `/ru...` — адрес в браузере не меняется (никакого редиректа). Пути
// `/en...` и `/zh...` проходят как есть (middleware на них не срабатывает — см.
// matcher: только корень и внутренние страницы без локального префикса).
export function middleware(request: NextRequest) {
  const url = request.nextUrl.clone();
  url.pathname = `/ru${url.pathname === '/' ? '' : url.pathname}`;
  return NextResponse.rewrite(url);
}

export const config = {
  matcher: ['/', '/calculator', '/compare'],
};
