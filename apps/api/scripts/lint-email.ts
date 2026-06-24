#!/usr/bin/env tsx
/*
 * Линтер исходящих писем DirectPort. Прогоняет текст письма через жёсткие
 * запреты из docs/EMAIL_STYLE.md и ловит то, что недопустимо в любом письме:
 *   - русские/типографские кавычки «» „" ‘’
 *   - em-dash — и en-dash –
 * (а также проектные слова-запреты, если они заданы в lint-rules.ts).
 *
 * Использование (из корня репозитория):
 *   pnpm lint-email <path-to-body.txt>
 *   pbpaste | pnpm lint-email           # текст из stdin (без аргумента)
 *
 * Коды выхода: 0 — чисто, 1 — ошибка использования, 2 — не читается файл,
 * 3 — есть нарушения. Удобно для pre-send проверки и CI.
 *
 * Не ловит контекстные запреты (тон, длина, что писать на какой стадии) —
 * их проверяй глазами по docs/EMAIL_STYLE.md.
 */

import { readFileSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import { lintText } from './lint-rules';

function readInput(path: string | undefined): string {
  // Без аргумента читаем stdin — позволяет `pbpaste | pnpm lint-email`.
  if (path === undefined) return readFileSync(0, 'utf8');
  // pnpm запускает скрипт в cwd=apps/api; относительный путь резолвим от каталога,
  // откуда пользователь вызвал команду (INIT_CWD) — как это делает read-doc.
  const base = process.env.INIT_CWD ?? process.cwd();
  return readFileSync(isAbsolute(path) ? path : resolve(base, path), 'utf8');
}

function main(): number {
  // pnpm-алиас прокидывает завершающий "--" как литеральный аргумент - отбрасываем его.
  const path = process.argv.slice(2).find((a) => a !== '--');

  let body: string;
  try {
    body = readInput(path);
  } catch (e) {
    const src = path ?? 'stdin';
    console.error(`cannot read ${src}: ${(e as Error).message}`);
    return path ? 2 : 1;
  }

  const label = path ?? 'stdin';
  const violations = lintText(body);

  if (violations.length === 0) {
    console.log(`lint-email ${label}: clean (docs/EMAIL_STYLE.md)`);
    return 0;
  }

  console.error(`lint-email ${label}: ${violations.length} violation(s) of docs/EMAIL_STYLE.md`);
  for (const v of violations) {
    const shown = v.samples.slice(0, 5).join(', ');
    const more = v.samples.length > 5 ? ` (+${v.samples.length - 5} more)` : '';
    console.error(`  - ${v.rule}`);
    console.error(`    found: ${shown}${more}`);
  }
  return 3;
}

process.exit(main());
