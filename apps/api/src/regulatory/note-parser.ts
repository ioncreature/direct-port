import type { AssessmentForm } from './interfaces';

/**
 * Извлекает идентификатор технического регламента из NOTE.
 * Возвращает первый найденный регламент в нормализованной форме "ТР ТС 020/2011" или
 * "ТР ЕАЭС 037/2016". null — если в тексте регламент не упомянут (это ок: для лицензий,
 * утильсбора, страновых запретов в NOTE стоят ссылки на ПП РФ, ФЗ и пр.).
 */
export function extractRegulation(note: string): string | null {
  const matches = findAllRegulations(note);
  return matches[0] ?? null;
}

export function findAllRegulations(note: string): string[] {
  if (!note) return [];
  const result: string[] = [];
  const seen = new Set<string>();
  const re = /Т[РP]\s*(ТС|ЕАЭС)\s*(\d+)\s*\/\s*(\d{4})/gi;
  for (const match of note.matchAll(re)) {
    const kind = match[1].toUpperCase();
    const number = match[2];
    const year = match[3];
    const normalized = `ТР ${kind} ${number}/${year}`;
    if (!seen.has(normalized)) {
      seen.add(normalized);
      result.push(normalized);
    }
  }
  return result;
}

const QUOTED_TITLE_RE = /[«"„]([^«»"„]{10,200})[»"]/g;
const REGULATION_NUMBER_RE = /(\d+\/\d{4})$/;

/**
 * Пытается найти название регламента в кавычках рядом с номером.
 * Стратегия: берём ±200 символов вокруг первого упоминания регламента, ищем строку
 * в кавычках длиной 10–200 символов. Кавычки бывают как обычные ASCII ("..."),
 * так и «...» / „...". Возвращаем без обрамляющих кавычек.
 */
export function extractRegulationTitle(note: string, regulation: string | null): string | null {
  if (!note) return null;
  const numberMatch = regulation?.match(REGULATION_NUMBER_RE);
  let center: number | null = null;
  if (numberMatch) {
    const idx = note.indexOf(numberMatch[1]);
    if (idx >= 0) center = idx;
  }

  const start = center == null ? 0 : Math.max(0, center - 200);
  const end = center == null ? note.length : Math.min(note.length, center + 200);
  const window = note.slice(start, end);

  QUOTED_TITLE_RE.lastIndex = 0;
  const match = QUOTED_TITLE_RE.exec(window);
  return match ? match[1].trim() : null;
}

interface FormPattern {
  pattern: RegExp;
  form: AssessmentForm;
}

/**
 * Порядок важен: первое срабатывание выигрывает. Сначала идут специфичные формы
 * (госрегистрация, нотификация, сбор), потом — общие (декларирование/сертификация),
 * потому что общий «сертификации» иначе перехватывал бы СГР-ноту, где обе формы
 * упомянуты. JS RegExp `\w` НЕ покрывает кириллицу, поэтому используем явные
 * символьные классы либо короткие ключевые корни без квантора.
 */
const FORM_PATTERNS: FormPattern[] = [
  { pattern: /государственн[а-яё]*\s+регистрац/iu, form: 'state_registration' },
  { pattern: /\bСГР\b/u, form: 'state_registration' },
  { pattern: /нотификац/iu, form: 'notification' },
  { pattern: /(утилизационн|экологическ)[а-яё]*\s+сбор/iu, form: 'fee' },
  { pattern: /лицензи/iu, form: 'license' },
  { pattern: /разрешени[еяй]/iu, form: 'permit' },
  { pattern: /заключени[еяй]/iu, form: 'permit' },
  { pattern: /декларирован/iu, form: 'declaration' },
  { pattern: /декларац[а-яё]*\s+о\s+соответствии/iu, form: 'declaration' },
  { pattern: /сертификац/iu, form: 'certificate' },
];

/**
 * Извлекает форму оценки соответствия / документа.
 * Возвращает 'unknown' если ни один паттерн не сработал — UI покажет в этом случае только
 * сырое NOTE и пометку «форма не распознана».
 */
export function extractForm(note: string): AssessmentForm {
  if (!note) return 'unknown';
  for (const { pattern, form } of FORM_PATTERNS) {
    if (pattern.test(note)) return form;
  }
  return 'unknown';
}

interface AuthorityPattern {
  pattern: RegExp;
  name: string;
}

/**
 * Список регулирующих ведомств. Порядок: специфичные имена выше, общие ниже —
 * это позволяет «Минпромторг России» побеждать «Министерство промышленности».
 */
const AUTHORITY_PATTERNS: AuthorityPattern[] = [
  { pattern: /Минпромторг/iu, name: 'Минпромторг России' },
  { pattern: /Министерств[а-яё]*\s+промышленности\s+и\s+торговли/iu, name: 'Минпромторг России' },
  { pattern: /Минцифр/iu, name: 'Минцифры России' },
  { pattern: /Министерств[а-яё]*\s+цифрового\s+развития/iu, name: 'Минцифры России' },
  { pattern: /Главгоссвязьнадзор/iu, name: 'Минцифры России / Роскомнадзор' },
  { pattern: /Роскомнадзор/iu, name: 'Роскомнадзор' },
  { pattern: /Роспотребнадзор/iu, name: 'Роспотребнадзор' },
  { pattern: /защиты\s+прав\s+потребителей/iu, name: 'Роспотребнадзор' },
  { pattern: /Росздравнадзор/iu, name: 'Росздравнадзор' },
  { pattern: /Минздрав/iu, name: 'Минздрав России' },
  { pattern: /\bФСБ\b/u, name: 'ФСБ России' },
  { pattern: /Минобороны/iu, name: 'Минобороны России' },
  { pattern: /Министерств[а-яё]*\s+обороны/iu, name: 'Минобороны России' },
  { pattern: /Росприроднадзор/iu, name: 'Росприроднадзор' },
  { pattern: /в\s+сфере\s+природопользования/iu, name: 'Росприроднадзор' },
  { pattern: /ФТС\s+Росси/iu, name: 'ФТС России' },
  { pattern: /Россельхознадзор/iu, name: 'Россельхознадзор' },
];

/**
 * Извлекает упоминание регулятора (исполнительный орган РФ). null если в NOTE упомянуты
 * только наднациональные документы (Решение ЕЭК и т. п.) без конкретного ведомства РФ.
 */
export function extractAuthority(note: string): string | null {
  if (!note) return null;
  for (const { pattern, name } of AUTHORITY_PATTERNS) {
    if (pattern.test(note)) return name;
  }
  return null;
}

/**
 * Возвращает первый осмысленный абзац NOTE без префикса «Внимание!» — используется как
 * fallback summary, если ни регламент, ни форма не распознаны. Намеренно НЕ режем по
 * первой точке: в текстах TKS точки сидят в датах («01.09.26г.»), номерах документов
 * и сокращениях, и резка по `[.!?]` даёт обрывки. Берём всю первую строку, обрезаем
 * по символьному пределу.
 */
export function firstMeaningfulSentence(note: string): string {
  if (!note) return '';
  const cleaned = note
    .replace(/^Внимание[!.,\s]*/giu, '')
    .replace(/^ВНИМАНИЕ[!.,\s]*/gu, '')
    .replace(/\r\n+/g, '\n')
    .trim();
  const firstParagraph = cleaned.split('\n').find((line) => line.trim().length > 0) ?? '';
  // Если в строке несколько предложений, оставляем первое — но границу определяем по
  // «точка + пробел + заглавная буква», чтобы точки в датах (01.09.26г.), номерах (N 4)
  // и сокращениях не резали фразу пополам.
  const breakMatch = firstParagraph.match(/[.!?](\s+)(?=[А-ЯЁA-Z])/u);
  const candidate = breakMatch
    ? firstParagraph.slice(0, breakMatch.index! + 1)
    : firstParagraph;
  const text = candidate.trim();
  return text.length > 320 ? text.slice(0, 317).trimEnd() + '…' : text;
}
