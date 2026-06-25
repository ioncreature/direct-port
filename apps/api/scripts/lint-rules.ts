// Правила типографики для исходящих писем DirectPort. См. docs/EMAIL_STYLE.md.
//
// Вынесены отдельным модулем (а не внутри lint-email.ts), чтобы те же правила
// можно было применить к произвольному тексту из кода — например, прогнать
// сгенерированное письмо перед отправкой.
//
// Портировано из firstpass (scripts/lint-rules.ts). Универсальная типографика
// сохранена; продуктовые/брендовые слова firstpass убраны. Слова, недопустимые
// именно в письмах DirectPort, добавляются в PROJECT_WORD_RULES ниже.

export type LintRule = {
  rule: string;
  pattern: RegExp;
};

// JS \b в regex — ASCII-only, между кириллическими буквами никогда не срабатывает.
// Поэтому для русских слов своя граница через lookaround на букву/цифру/подчёркивание.
// Экспортируются как переиспользуемые помощники для PROJECT_WORD_RULES (см. пример ниже).
export const NB = '(?<![\\p{L}\\p{N}_])';
export const NA = '(?![\\p{L}\\p{N}_])';

// Универсальная типографика — недопустима в любом исходящем письме.
// «Ёлочки», «лапки» и em/en-dash — самые яркие маркеры шаблонного Word/AI-текста,
// которые вычитывают и люди, и спам-фильтры.
const TYPOGRAPHY_RULES: LintRule[] = [
  { rule: 'guillemets (« »)', pattern: /[«»]/gu },
  { rule: 'curly double quotes („ “ ”)', pattern: /[„“”]/gu },
  { rule: 'curly single quotes (‘ ’ ‚ ‛)', pattern: /[‘’‚‛]/gu },
  { rule: 'em-dash (—) - use ASCII hyphen "-"', pattern: /—/gu },
  { rule: 'en-dash (–) - use ASCII hyphen "-"', pattern: /–/gu },
];

// Слова, недопустимые именно в письмах DirectPort. Добавляй сюда по мере того,
// как накапливаются договорённости по терминологии (формат: NB + слово + NA для
// русских слов, чтобы граница работала по кириллице). Пример:
//   { rule: 'forbidden word: "растаможка" (use "таможенное оформление")',
//     pattern: new RegExp(`${NB}растаможк\\p{L}*${NA}`, 'giu') },
const PROJECT_WORD_RULES: LintRule[] = [];

export const TEXT_RULES: LintRule[] = [...TYPOGRAPHY_RULES, ...PROJECT_WORD_RULES];

export type LintViolation = {
  rule: string;
  samples: string[];
};

export function lintText(text: string): LintViolation[] {
  return TEXT_RULES.flatMap(({ rule, pattern }) => {
    const found = [...text.matchAll(pattern)].map((m) => m[0]);
    return found.length === 0 ? [] : [{ rule, samples: [...new Set(found)] }];
  });
}
