import { Priznak, type TnvedCode, type TnvedallEntry } from '@direct-port/tks-api';
import { Injectable } from '@nestjs/common';
import { formatIsoDate, formatPeriod } from '../common/format-date';
import { normalizeOksmtCode } from '../common/oksmt';
import { CountriesService } from '../countries/countries.service';
import {
  extractAuthority,
  extractForm,
  extractRegulation,
  extractRegulationTitle,
  firstMeaningfulSentence,
} from './note-parser';
import {
  type AssessmentForm,
  type MatchPrecision,
  type RegulatoryCategory,
  type RegulatoryItem,
  type RegulatoryReport,
} from './interfaces';

/**
 * Карта PRIZNAK→категория. Ключи NotForRegulatory (1=пошлина, 3=НДС, 2=акциз, 19/20/30
 * страновые ставки, 22/23 сборы) обрабатываются отдельно в Calculator/DutyInterpreter
 * и в этот отчёт не попадают. PRIZNAK 16 (временная пошлина) тоже не наша.
 */
const PRIZNAK_TO_CATEGORY: Record<number, RegulatoryCategory> = {
  [Priznak.Certification]: 'certification',
  [Priznak.LicenseExport]: 'license_export',
  [Priznak.LicenseImport]: 'license_import',
  [Priznak.PermitImport]: 'permit_import',
  [Priznak.PermitExport]: 'permit_export',
  [Priznak.Marking]: 'marking',
  [Priznak.Traceability]: 'traceability',
  [Priznak.Utilization]: 'utilization',
  [Priznak.StrategicGoods]: 'strategic',
  [Priznak.DualUseImport]: 'dual_use_import',
  [Priznak.DualUseExport]: 'dual_use_export',
  [Priznak.CountryImportBan]: 'country_import_ban',
  [Priznak.CountryExportBan]: 'country_export_ban',
  [Priznak.OtherFeatures]: 'other',
};

const FORM_LABEL: Record<AssessmentForm, string> = {
  declaration: 'декларация о соответствии',
  certificate: 'сертификат соответствия',
  state_registration: 'свидетельство о государственной регистрации',
  notification: 'нотификация',
  permit: 'разрешение/заключение',
  license: 'лицензия',
  fee: 'обязательный платёж',
  unknown: 'форма не распознана',
};

const CATEGORY_TITLE: Record<RegulatoryCategory, string> = {
  certification: 'Подтверждение соответствия',
  permit_import: 'Разрешение на ввоз',
  permit_export: 'Разрешение на вывоз',
  license_import: 'Лицензия на ввоз',
  license_export: 'Лицензия на вывоз',
  marking: 'Обязательная маркировка',
  traceability: 'Прослеживаемость',
  utilization: 'Утилизационный/экологический сбор',
  strategic: 'Стратегические товары',
  dual_use_import: 'Двойное назначение (ввоз)',
  dual_use_export: 'Двойное назначение (вывоз)',
  country_import_ban: 'Запреты/санкции на ввоз по стране',
  country_export_ban: 'Запреты/санкции на вывоз по стране',
  other: 'Прочие меры регулирования',
};

@Injectable()
export class RegulatoryRequirementsService {
  constructor(private readonly countriesService: CountriesService) {}

  /**
   * Строит RegulatoryReport из TnvedCode.TNVEDALL. Для запретов по странам (PRIZNAK 34/35)
   * резолвит OKSMT-код в название страны через CountriesService. Лишних запросов к TKS не
   * делает: данные TNVEDALL уже получены в `getTnvedCode`, который и так вызывается на
   * каждом коде в /tn-ved и пайплайне.
   */
  async buildReport(tnved: TnvedCode): Promise<RegulatoryReport> {
    const conditions = tnved.TNVEDALL ?? {};

    const flatItems: RegulatoryItem[] = [];
    for (const [priznakStr, entries] of Object.entries(conditions)) {
      if (!Array.isArray(entries) || entries.length === 0) continue;
      const priznak = Number(priznakStr);
      const category = PRIZNAK_TO_CATEGORY[priznak];
      if (!category) continue;
      for (const entry of entries) {
        flatItems.push(await this.toItem(entry, priznak, category, tnved.CODE));
      }
    }

    return groupReport(flatItems);
  }

  private async toItem(
    entry: TnvedallEntry,
    priznak: number,
    category: RegulatoryCategory,
    targetCode: string,
  ): Promise<RegulatoryItem> {
    const note = entry.NOTE ?? '';
    const regulation = extractRegulation(note);
    const regulationTitle = extractRegulationTitle(note, regulation);
    const form = chooseForm(category, extractForm(note));
    const authority = extractAuthority(note);
    const documentRef = entry.DOC_N
      ? { number: entry.DOC_N, date: entry.DOC_D ?? null }
      : null;

    const codeMin = entry.CODEMIN ?? '';
    const codeMax = entry.CODEMAX ?? null;
    const matchPrecision = computeMatchPrecision(codeMin, targetCode);

    const countryCode = isCountryCategory(category) ? normalizeOksmtCode(entry.CU) : null;
    const country =
      countryCode != null ? await this.countriesService.findByCode(countryCode) : null;
    const countryName = country?.nameRu ?? null;

    return {
      category,
      priznak,
      title: buildTitle(category, regulation, regulationTitle, form, countryName),
      summary: buildSummary({
        category,
        regulation,
        regulationTitle,
        form,
        authority,
        documentRef,
        countryName,
        note,
        validFrom: entry.DBEGIN ?? null,
        validTo: entry.DEND ?? null,
      }),
      regulation,
      regulationTitle,
      form,
      authority,
      documentRef,
      validFrom: entry.DBEGIN ?? null,
      validTo: entry.DEND ?? null,
      matchPrecision,
      codeRange: { min: codeMin, max: codeMax },
      countryCode,
      countryName,
      values: {
        min: entry.MIN ?? null,
        max: entry.MAX ?? null,
        unit: entry.TYPEMIN ?? null,
      },
      rawNote: note,
    };
  }
}

function isCountryCategory(category: RegulatoryCategory): boolean {
  return category === 'country_import_ban' || category === 'country_export_ban';
}

/**
 * Категории, где форма документа предопределена самой природой меры — парсер NOTE
 * для них не используется (иначе цитата «декларирование/сертификация» из общего
 * предисловия NOTE сбила бы метку формы для лицензии или маркировки).
 */
const CATEGORY_FIXED_FORM: Partial<Record<RegulatoryCategory, AssessmentForm>> = {
  license_import: 'license',
  license_export: 'license',
  permit_import: 'permit',
  permit_export: 'permit',
  utilization: 'fee',
};

/**
 * Категории, где сама мера НЕ является «декларация/сертификат/СГР», но эти слова
 * могут встречаться в NOTE как часть пояснений. Если парсер вернул такой ярлык —
 * считаем его шумом и опускаемся в 'unknown', чтобы UI показал по category.
 */
const CONFOUND_DOC_FORMS: ReadonlySet<AssessmentForm> = new Set([
  'declaration',
  'certificate',
  'state_registration',
]);
const CATEGORIES_IGNORING_DOC_FORMS: ReadonlySet<RegulatoryCategory> = new Set([
  'marking',
  'traceability',
  'country_import_ban',
  'country_export_ban',
  'strategic',
  'dual_use_import',
  'dual_use_export',
]);

function chooseForm(category: RegulatoryCategory, parsed: AssessmentForm): AssessmentForm {
  const fixed = CATEGORY_FIXED_FORM[category];
  if (fixed) return fixed;
  if (CATEGORIES_IGNORING_DOC_FORMS.has(category) && CONFOUND_DOC_FORMS.has(parsed)) {
    return 'unknown';
  }
  return parsed;
}

/**
 * Точность совпадения по длине CODEMIN (структура ТН ВЭД ЕАЭС: 2 = глава, 4 = товарная
 * позиция, 6 = субпозиция, 10 = подсубпозиция).
 * - exact: запись помечена ровно нашим 10-значным кодом или его 8-знаком (подсубпозицией)
 * - narrow: товарная позиция или субпозиция (4–7 знаков)
 * - broad: группа/раздел (≤ 3 знаков) — мера применима ко всему диапазону, и фактическая
 *   применимость требует ручной проверки (false-positive риск)
 */
function computeMatchPrecision(codeMin: string, targetCode: string): MatchPrecision {
  const minDigits = codeMin.replace(/\D/g, '');
  if (minDigits.length >= 8 && targetCode.startsWith(minDigits)) return 'exact';
  if (minDigits.length >= 4) return 'narrow';
  return 'broad';
}

function buildTitle(
  category: RegulatoryCategory,
  regulation: string | null,
  regulationTitle: string | null,
  form: AssessmentForm,
  countryName: string | null,
): string {
  if (isCountryCategory(category)) {
    const cat = CATEGORY_TITLE[category];
    return countryName ? `${cat}: ${countryName}` : cat;
  }
  if (regulation) {
    const formLabel = form !== 'unknown' ? FORM_LABEL[form] : null;
    const head = regulationTitle ? `${regulation} «${regulationTitle}»` : regulation;
    return formLabel ? `${head} — ${formLabel}` : head;
  }
  return CATEGORY_TITLE[category];
}

interface SummaryInput {
  category: RegulatoryCategory;
  regulation: string | null;
  regulationTitle: string | null;
  form: AssessmentForm;
  authority: string | null;
  documentRef: { number: string; date: string | null } | null;
  countryName: string | null;
  note: string;
  validFrom: string | null;
  validTo: string | null;
}

/**
 * Собирает информативную сводку (2–4 предложения), отвечая на «что требуется», «кто требует»,
 * «на основании чего» и «когда действует». Если ничего распознать не удалось — fallback к
 * первой осмысленной фразе NOTE, чтобы оператор видел хоть какой-то контекст.
 */
function buildSummary(input: SummaryInput): string {
  const parts: string[] = [];

  if (isCountryCategory(input.category)) {
    const subject =
      input.category === 'country_import_ban'
        ? 'Возможны ограничения / санкции на ввоз товара'
        : 'Возможны ограничения / санкции на вывоз товара';
    parts.push(input.countryName ? `${subject} из/в страну: ${input.countryName}.` : `${subject}.`);
  } else if (input.regulation) {
    const formLabel = input.form !== 'unknown' ? FORM_LABEL[input.form] : null;
    const subject = formLabel
      ? `Требуется ${formLabel} в рамках ${input.regulation}`
      : `Применим ${input.regulation}`;
    const titleSuffix = input.regulationTitle ? ` «${input.regulationTitle}»` : '';
    parts.push(`${subject}${titleSuffix}.`);
  } else {
    parts.push(`${CATEGORY_TITLE[input.category]}.`);
  }

  if (input.authority) parts.push(`Регулирует: ${input.authority}.`);

  if (input.documentRef) {
    const date = input.documentRef.date ? ` от ${formatIsoDate(input.documentRef.date)}` : '';
    parts.push(`Основание: документ N ${input.documentRef.number}${date}.`);
  }

  if (input.validFrom || input.validTo) {
    parts.push(`Период действия: ${formatPeriod(input.validFrom, input.validTo)}.`);
  }

  // Если получилось пусто (нечего распознавать), берём первую осмысленную фразу из NOTE
  // — это уже дано в первой ветке через CATEGORY_TITLE, но иногда NOTE даёт больше.
  const summary = parts.join(' ').trim();
  if (summary.length > 0) return summary;
  return firstMeaningfulSentence(input.note);
}

/**
 * Раскладывает плоский список в группы для UI. Сортировка: сначала по matchPrecision
 * (exact выше), затем внутри одной точности — по длине CODEMIN (более длинный = ближе
 * к коду товара = выше в списке).
 */
function groupReport(items: RegulatoryItem[]): RegulatoryReport {
  const sorted = [...items].sort((a, b) => {
    const dp = precisionWeight(a) - precisionWeight(b);
    if (dp !== 0) return dp;
    return b.codeRange.min.length - a.codeRange.min.length;
  });
  const report: RegulatoryReport = {
    certifications: [],
    permits: [],
    licenses: [],
    marking: [],
    traceability: [],
    utilizationFee: [],
    strategicAndDualUse: [],
    countryRestrictions: [],
    other: [],
    totalCount: sorted.length,
  };
  for (const item of sorted) {
    switch (item.category) {
      case 'certification':
        report.certifications.push(item);
        break;
      case 'permit_import':
      case 'permit_export':
        report.permits.push(item);
        break;
      case 'license_import':
      case 'license_export':
        report.licenses.push(item);
        break;
      case 'marking':
        report.marking.push(item);
        break;
      case 'traceability':
        report.traceability.push(item);
        break;
      case 'utilization':
        report.utilizationFee.push(item);
        break;
      case 'strategic':
      case 'dual_use_import':
      case 'dual_use_export':
        report.strategicAndDualUse.push(item);
        break;
      case 'country_import_ban':
      case 'country_export_ban':
        report.countryRestrictions.push(item);
        break;
      case 'other':
        report.other.push(item);
        break;
    }
  }
  return report;
}

function precisionWeight(item: RegulatoryItem): number {
  switch (item.matchPrecision) {
    case 'exact':
      return 0;
    case 'narrow':
      return 1;
    case 'broad':
      return 2;
  }
}
