import { formatIsoDate } from '../common/format-date';
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

const GROUPS: Array<[GroupKey, string]> = [
  ['certifications', 'Сертификация / декларирование'],
  ['permits', 'Разрешения'],
  ['licenses', 'Лицензии'],
  ['marking', 'Маркировка'],
  ['traceability', 'Прослеживаемость'],
  ['utilizationFee', 'Утилизационный / экологический сбор'],
  ['strategicAndDualUse', 'Двойное назначение / стратегические товары'],
  ['countryRestrictions', 'Страновые ограничения'],
  ['other', 'Прочее'],
];

// Intl.NumberFormat возвращает NBSP (U+00A0) как разделитель тысяч —
// заменяем на обычный пробел, чтобы текст в Excel и тестах был предсказуемым.
const NUMBER_FORMATTER = new Intl.NumberFormat('ru-RU');
function formatNumber(n: number): string {
  return NUMBER_FORMATTER.format(n).replaceAll("\u00A0", " ");
}

function itemHeadline(item: RegulatoryItem): string {
  if (item.regulation) {
    const formStr = FORM_LONG[item.form];
    return formStr ? `${item.regulation} — ${formStr}` : item.regulation;
  }
  switch (item.category) {
    case 'marking': {
      const since = item.validFrom ? ` с ${formatIsoDate(item.validFrom)}` : '';
      return `Маркировка${since}`;
    }
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
    case 'country_import_ban':
      return item.countryName ? `Запрет ввоза: ${item.countryName}` : 'Запрет ввоза';
    case 'country_export_ban':
      return item.countryName ? `Запрет вывоза: ${item.countryName}` : 'Запрет вывоза';
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

function itemDetails(item: RegulatoryItem): string[] {
  const lines: string[] = [];

  if (item.regulationTitle) lines.push(item.regulationTitle);
  if (item.authority) lines.push(`Регулятор: ${item.authority}`);

  if (item.documentRef && item.documentRef.number) {
    const dateStr = item.documentRef.date ? ` от ${formatIsoDate(item.documentRef.date)}` : '';
    lines.push(`Основание: № ${item.documentRef.number}${dateStr}`);
  }

  // validFrom для маркировки уже в заголовке — не дублируем
  if (item.validFrom && item.category !== 'marking') {
    lines.push(`Действует с ${formatIsoDate(item.validFrom)}`);
  }
  if (item.validTo) {
    lines.push(`По ${formatIsoDate(item.validTo)}`);
  }

  if (item.matchPrecision === 'broad') {
    lines.push('Применимость: широкая — проверьте по конкретному коду товара');
  }

  return lines;
}

function formatItemLong(item: RegulatoryItem): string {
  const lines = ['• ' + itemHeadline(item)];
  for (const detail of itemDetails(item)) {
    lines.push('   ' + detail);
  }
  return lines.join('\n');
}

/**
 * Многострочный, человекочитаемый формат отчёта для Excel-колонки.
 * Группирует меры по категориям, дедуплицирует одинаковые блоки внутри группы
 * (один и тот же ТР повторяется в TKS — выводим раз). Возвращает '' если
 * report пуст. Высота строк не ограничена — формат рассчитан на wrapText.
 */
export function formatRegulatoryReportLong(report: RegulatoryReport | null | undefined): string {
  if (!report || report.totalCount === 0) return '';

  const groupBlocks: string[] = [];

  for (const [groupKey, groupTitle] of GROUPS) {
    const items = report[groupKey];
    if (!Array.isArray(items) || items.length === 0) continue;

    const seen = new Set<string>();
    const itemBlocks: string[] = [];
    for (const item of items) {
      const block = formatItemLong(item);
      if (seen.has(block)) continue;
      seen.add(block);
      itemBlocks.push(block);
    }
    if (itemBlocks.length === 0) continue;

    groupBlocks.push(`${groupTitle}:\n${itemBlocks.join('\n')}`);
  }

  return groupBlocks.join('\n\n');
}
