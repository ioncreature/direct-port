import type { AssessmentForm, RegulatoryItem, RegulatoryReport } from './interfaces';

const FORM_SHORT: Record<AssessmentForm, string> = {
  declaration: 'декл.',
  certificate: 'серт.',
  state_registration: 'СГР',
  notification: 'нотификация',
  permit: 'разреш.',
  license: 'лиценз.',
  fee: 'сбор',
  unknown: '',
};

/**
 * Компактная сводка одной записи: «ТР ТС 020/2011 декл.» / «Лицензия» /
 * «Маркировка с 01.05.2026» / «Утильсбор 32 874 ₽» — для Excel-колонки.
 * Цель — уместить максимум смысла в 1 строку 60–80 символов.
 */
function formatRegulatoryItem(item: RegulatoryItem): string {
  if (item.regulation) {
    const formStr = FORM_SHORT[item.form];
    return formStr ? `${item.regulation} ${formStr}` : item.regulation;
  }
  switch (item.category) {
    case 'marking': {
      const since = item.validFrom ? ` с ${formatShortDate(item.validFrom)}` : '';
      return `Маркировка${since}`;
    }
    case 'utilization': {
      const rate = item.values.min;
      return rate != null && rate > 0 ? `Утильсбор ${rate} ₽` : 'Утильсбор/экосбор';
    }
    case 'license_import':
    case 'license_export':
      return 'Лицензия';
    case 'permit_import':
    case 'permit_export':
      return 'Разрешение';
    case 'country_import_ban':
    case 'country_export_ban':
      return item.countryName ? `Запрет: ${item.countryName}` : 'Запрет/санкции';
    case 'traceability':
      return 'Прослеживаемость';
    case 'strategic':
    case 'dual_use_import':
    case 'dual_use_export':
      return 'Двойное назначение';
    default:
      return item.title || '—';
  }
}

function formatShortDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? `${m[3]}.${m[2]}.${m[1]}` : iso;
}

/**
 * Компактная одно-строчная (с точкой-с-запятой как разделителем) сводка report'а
 * для Excel. Дедуплицирует одинаковые тексты, чтобы не плодить «ТР ТС 020/2011 декл.»
 * по всем 9 одинаковым certifications записям. Возвращает '' если report пуст.
 */
export function formatRegulatoryReportShort(report: RegulatoryReport | null | undefined): string {
  if (!report || report.totalCount === 0) return '';
  const buckets: Array<keyof RegulatoryReport> = [
    'certifications',
    'permits',
    'licenses',
    'marking',
    'traceability',
    'utilizationFee',
    'strategicAndDualUse',
    'countryRestrictions',
    'other',
  ];
  const seen = new Set<string>();
  const parts: string[] = [];
  for (const key of buckets) {
    const items = report[key];
    if (!Array.isArray(items)) continue;
    for (const item of items) {
      const text = formatRegulatoryItem(item);
      if (!text || seen.has(text)) continue;
      seen.add(text);
      parts.push(text);
    }
  }
  return parts.join('; ');
}
