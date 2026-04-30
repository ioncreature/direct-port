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

// Группы, в которых юридические подробности (основание, срок действия) полезны
// в Excel: маркировка — оператору важно знать постановление и срок ввода;
// страновые запреты — нужен номер санкционного решения и дата.
// Для остальных групп те же поля шумят, в админке они доступны через summary.
const GROUPS_WITH_LEGAL_DETAILS: ReadonlySet<GroupKey> = new Set(['marking', 'countryRestrictions']);

// Intl.NumberFormat возвращает NBSP (U+00A0) как разделитель тысяч —
// заменяем на обычный пробел, чтобы текст в Excel и тестах был предсказуемым.
const NUMBER_FORMATTER = new Intl.NumberFormat('ru-RU');
function formatNumber(n: number): string {
  return NUMBER_FORMATTER.format(n).replaceAll("\u00A0", " ");
}

/**
 * Generic — мера, которая в Excel неотличима от названия категории
 * (нет regulation, нет уникальной суммы/страны). Их сворачиваем в одну строку
 * `+ N записей без явного регламента`, чтобы не плодить копии «Подтверждение
 * соответствия» / «Прочие меры регулирования».
 */
function isGeneric(item: RegulatoryItem): boolean {
  if (item.regulation) return false;
  if (item.category === 'marking') return false;
  if (item.category === 'utilization' && item.values.min != null && item.values.min > 0) return false;
  if (
    (item.category === 'country_import_ban' || item.category === 'country_export_ban') &&
    item.countryName
  ) {
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

function itemHeadline(item: RegulatoryItem): string {
  const base = itemHeadlineBase(item);
  return item.matchPrecision === 'broad' ? `${base} ⚠ широкое применение` : base;
}

function itemDetails(item: RegulatoryItem, groupKey: GroupKey): string[] {
  const lines: string[] = [];

  if (item.regulationTitle) lines.push(item.regulationTitle);
  if (item.authority) lines.push(`Регулятор: ${item.authority}`);

  if (!GROUPS_WITH_LEGAL_DETAILS.has(groupKey)) return lines;

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

  return lines;
}

function formatItemLong(item: RegulatoryItem, groupKey: GroupKey): string {
  const lines = ['• ' + itemHeadline(item)];
  for (const detail of itemDetails(item, groupKey)) {
    lines.push('   ' + detail);
  }
  return lines.join('\n');
}

/**
 * Ключ для дедупликации. Не включает documentRef/validFrom/validTo и precision —
 * одна и та же мера, утверждённая разными постановлениями или с разной точностью
 * совпадения, в Excel должна выводиться один раз.
 */
function dedupeKey(item: RegulatoryItem): string {
  return [itemHeadlineBase(item), item.regulationTitle ?? '', item.authority ?? ''].join('||');
}

/**
 * Многострочный, человекочитаемый формат отчёта для Excel-колонки.
 * Сильная дедупликация (по идентичности меры, не по полному блоку), generic-записи
 * без regulation сворачиваются в `+ N записей …`. Юридические подробности
 * (основание, срок) показываем только для маркировки и страновых запретов.
 * Возвращает '' если report пуст. Формат рассчитан на wrapText в Excel.
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
      itemBlocks.push(formatItemLong(item, groupKey));
    }
    if (generic.length === 1) {
      itemBlocks.push(formatItemLong(generic[0], groupKey));
    } else if (generic.length > 1) {
      itemBlocks.push(`+ ${generic.length} записей без явного регламента`);
    }

    if (itemBlocks.length === 0) continue;
    groupBlocks.push(`${groupTitle}:\n${itemBlocks.join('\n')}`);
  }

  return groupBlocks.join('\n\n');
}
