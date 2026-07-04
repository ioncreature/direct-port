import type { AssessmentForm, RegulatoryItem, RegulatoryReport } from './interfaces';

const FORM_LONG: Record<AssessmentForm, string> = {
  declaration: 'декларация о соответствии',
  certificate: 'сертификат соответствия',
  state_registration: 'свидетельство о государственной регистрации',
  notification: 'нотификация',
  permit: 'разрешение',
  license: 'лицензия',
  fee: 'сбор',
  unknown: '',
};

type GroupKey = keyof Omit<RegulatoryReport, 'totalCount'>;

// Маркировку, страновые запреты и «прочее» в Excel не выводим: в админке они
// полезны (полный контекст, summary, даты), а в строке документа дают шум —
// generic-записи, запреты по странам, не относящимся к этому товару, и т. п.
const GROUPS: Array<[GroupKey, string]> = [
  ['certifications', 'Сертификация / декларирование'],
  ['permits', 'Разрешения'],
  ['licenses', 'Лицензии'],
  ['traceability', 'Прослеживаемость'],
  ['utilizationFee', 'Утилизационный / экологический сбор'],
  ['strategicAndDualUse', 'Двойное назначение / стратегические товары'],
];

// Intl.NumberFormat ru-RU использует NBSP как разделитель тысяч — заменяем
// на обычный пробел, чтобы текст в Excel и тестах был предсказуемым.
const NUMBER_FORMATTER = new Intl.NumberFormat('ru-RU');
function formatNumber(n: number): string {
  return NUMBER_FORMATTER.format(n).replaceAll('\u00A0', ' ');
}

// Generic — мера без regulation и без уникального идентификатора (суммы, страны).
// 2+ таких записей сворачиваем в одну строку, иначе они плодят копии
// «Подтверждение соответствия» / «Лицензия».
function isGeneric(item: RegulatoryItem): boolean {
  if (item.regulation) return false;
  if (item.category === 'utilization' && item.values.min != null && item.values.min > 0) {
    return false;
  }
  return true;
}

function itemHeadlineBase(item: RegulatoryItem): string {
  if (item.regulation) {
    const formStr = FORM_LONG[item.form];
    return formStr ? `${item.regulation} — ${formStr}` : item.regulation;
  }
  switch (item.category) {
    case 'utilization': {
      const rate = item.values.min;
      return rate != null && rate > 0
        ? `Утильсбор ${formatNumber(rate)} ₽ за единицу`
        : 'Утилизационный / экологический сбор';
    }
    case 'license_import':
    case 'license_export':
      return 'Лицензия';
    case 'permit_import':
    case 'permit_export':
      return 'Разрешение';
    case 'traceability':
      return 'Прослеживаемость';
    case 'strategic':
    case 'dual_use_import':
    case 'dual_use_export':
      return 'Двойное назначение / стратегические товары';
    default:
      return item.title || '—';
  }
}

function itemHeadline(item: RegulatoryItem): string {
  const base = itemHeadlineBase(item);
  return item.matchPrecision === 'broad' ? `${base} ⚠ широкое применение` : base;
}

/**
 * Текст предупреждения о страновом запрете/ограничении ввоза — общий для листа
 * «Проект ДТ» и чек-листа «Документы к поставке». Фильтрация по стране товара
 * остаётся на вызывающей стороне.
 */
export function formatCountryBanWarning(item: RegulatoryItem): string {
  const country = item.countryName ?? item.countryCode;
  return (
    `Запрет/ограничение ввоза${country ? ` (${country})` : ''}: ${item.title}` +
    (item.matchPrecision === 'broad' ? ' ⚠ широкое применение — проверьте вручную' : '')
  );
}

function itemDetails(item: RegulatoryItem): string[] {
  const lines: string[] = [];
  if (item.regulationTitle) lines.push(item.regulationTitle);
  if (item.authority) lines.push(`Регулятор: ${item.authority}`);
  return lines;
}

function formatItemLong(item: RegulatoryItem): string {
  const lines = ['• ' + itemHeadline(item)];
  for (const detail of itemDetails(item)) {
    lines.push('   ' + detail);
  }
  return lines.join('\n');
}

// Ключ дедупликации без precision и юридических подробностей: одна и та же
// мера, утверждённая разными постановлениями или совпавшая с разной точностью,
// в Excel должна выводиться один раз.
function dedupeKey(item: RegulatoryItem): string {
  return [itemHeadlineBase(item), item.regulationTitle ?? '', item.authority ?? ''].join('||');
}

/**
 * Многострочный формат регуляторных мер для Excel-колонки. Группирует по
 * категориям, дедуплицирует по идентичности меры, generic-записи без regulation
 * сворачиваются в `+ N записей …`. Возвращает '' если report пуст.
 * Формат рассчитан на wrapText.
 */
export function formatRegulatoryReportLong(report: RegulatoryReport | null | undefined): string {
  if (!report || report.totalCount === 0) return '';

  const groupBlocks: string[] = [];

  for (const [groupKey, groupTitle] of GROUPS) {
    const items = report[groupKey];
    if (!Array.isArray(items) || items.length === 0) continue;

    const seen = new Set<string>();
    const unique: RegulatoryItem[] = [];
    for (const item of items) {
      const key = dedupeKey(item);
      if (seen.has(key)) continue;
      seen.add(key);
      unique.push(item);
    }

    const withRegulation: RegulatoryItem[] = [];
    const generic: RegulatoryItem[] = [];
    for (const item of unique) {
      if (isGeneric(item)) generic.push(item);
      else withRegulation.push(item);
    }

    const itemBlocks: string[] = [];
    for (const item of withRegulation) {
      itemBlocks.push(formatItemLong(item));
    }
    if (generic.length === 1) {
      itemBlocks.push(formatItemLong(generic[0]));
    } else if (generic.length > 1) {
      itemBlocks.push(`+ ${generic.length} записей без явного регламента`);
    }

    if (itemBlocks.length === 0) continue;
    groupBlocks.push(`${groupTitle}:\n${itemBlocks.join('\n')}`);
  }

  return groupBlocks.join('\n\n');
}
