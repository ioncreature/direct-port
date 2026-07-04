import { OKSMT_BY_CODE } from '../countries/oksmt.data';
import { roundMoney } from '../common/money';
import { round4 } from '../common/numbers';
import { normalizeOksmtCode } from '../common/oksmt';
import type { ProductAttributeKey, ProductAttributes } from '../common/product-attributes';
import { hasAntidumpingNote, type ProductNote } from '../common/product-notes';
import type { RegulatoryItem, RegulatoryReport } from '../regulatory/interfaces';
import { formatCountryBanWarning } from '../regulatory/regulatory-format';
import {
  G44_CONFORMITY_CODES,
  G44_IMPORT_LICENSE,
  G44_UTILIZATION_FEE,
} from '../regulatory/curated/g44-codes';
import { estimateCustomsFeeRub } from './customs-fee';

/**
 * «Проект ДТ» — черновик группировки построчного расчёта в товары декларации.
 *
 * «Один товар» в ДТ (Решение КТС № 257) — позиции одного кода ТН ВЭД и одной
 * страны происхождения: строки resultData группируются по этому ключу, суммы
 * и веса агрегируются в терминах граф ДТ (31/33/34/35/38/41/42/45/46/47).
 * Это подспорье декларанту для переноса в Контур/Альту/СТМ, НЕ замена ДТ.
 */

/** Строка resultData в полях, нужных для сборки товара ДТ. Все поля читаются толерантно. */
export interface DtRowInput {
  description?: string;
  quantity?: number;
  weight?: number;
  weightGross?: number | null;
  attributes?: ProductAttributes | null;
  /** Страна происхождения строки (OKSMT), если отличается от страны документа. */
  countryOfOrigin?: string | null;
  tnVedCode?: string;
  supplementaryUnit?: string | null;
  supplementaryQuantity?: number | null;
  totalPrice?: number;
  freightShare?: number;
  dutyAmount?: number;
  vatAmount?: number;
  exciseAmount?: number;
  totalPriceRub?: number;
  freightShareRub?: number;
  dutyAmountRub?: number;
  vatAmountRub?: number;
  exciseAmountRub?: number;
  calculationStatus?: string;
  notes?: ProductNote[];
  regulatoryReport?: RegulatoryReport | null;
}

export interface DtGood {
  /** Номер товара в проекте ДТ (1..N). */
  goodNumber: number;
  /** Графа 33. */
  tnVedCode: string;
  /** Графа 34: OKSMT-код и название (если страна известна). */
  countryCode: string | null;
  countryName: string | null;
  /** 1-based номера строк листа «Результат», вошедших в товар. */
  rowNumbers: number[];
  /** Черновик описания для графы 31 (наименования + производитель/бренд/артикул/материал). */
  descriptionDraft: string;
  /** Графа 35, кг (3 знака). Если брутто не извлечён — оценка по нетто. */
  grossWeightKg: number;
  grossIsEstimated: boolean;
  /** Графа 38, кг (3 знака). */
  netWeightKg: number;
  /** Графа 41: доп. единица кода и количество в ней (null — данных не хватило). */
  supplementaryUnit: string | null;
  supplementaryQuantity: number | null;
  /** Графа 42: цена товара в валюте документа (Σ totalPrice). */
  invoiceValue: number;
  /** Графа 45: таможенная стоимость в валюте документа (цена + доля фрахта). */
  customsValue: number;
  /** Графа 45 в рублях (null — конвертация недоступна). */
  customsValueRub: number | null;
  /** Графа 46: статистическая стоимость в USD (null — нет курса USD). */
  statisticalValueUsd: number | null;
  /** Графа 47 (₽): суммы платежей по товару. null — конвертация недоступна. */
  dutyRub: number | null;
  exciseRub: number | null;
  vatRub: number | null;
  /** ИТС — индекс таможенной стоимости, $/кг нетто (главный риск-триггер КТС). */
  itcUsdPerKg: number | null;
  /** Подсказки по документам графы 44 (из regulatoryReport). */
  documentHints: string[];
  warnings: string[];
}

export interface DtProject {
  goods: DtGood[];
  /** 1-based номера строк без кода ТН ВЭД — в товары не вошли. */
  unassignedRows: number[];
  totals: {
    customsValue: number;
    customsValueRub: number | null;
    statisticalValueUsd: number | null;
    /** Сбор за таможенные операции по лестнице от общей таможенной стоимости ДТ. */
    customsFeeRub: number | null;
    /** Партия дороже порога освобождения → потребуется ДТС-1. null — USD-оценка недоступна. */
    needsDts1: boolean | null;
  };
  warnings: string[];
}

/** Порог освобождения от ДТС (Решение Коллегии ЕЭК № 160): стоимость партии ≤ $10 000. */
const DTS_EXEMPTION_THRESHOLD_USD = 10_000;

const ATTRIBUTE_LABELS: Record<ProductAttributeKey, string> = {
  manufacturer: 'Производитель',
  brand: 'Товарный знак',
  article: 'Артикул',
  model: 'Модель',
  material: 'Материал',
  purpose: 'Назначение',
};

/** Порядок атрибутов в графе 31 — как в Инструкции № 257 (производитель, знак, модели/артикулы…). */
const GRAPH31_ATTRIBUTE_ORDER: ProductAttributeKey[] = [
  'manufacturer',
  'brand',
  'model',
  'article',
  'material',
  'purpose',
];

const MAX_G31_DESCRIPTIONS = 8;
const MAX_G31_ATTR_VALUES = 5;

/** Графы 35/38 заполняются с точностью 3 знака (Инструкция № 257). */
const round3 = (v: number) => Math.round(v * 1000) / 1000;

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/** Число или null: для агрегатов, где отсутствие значения у ЛЮБОЙ строки делает сумму неизвестной. */
function sumOrNull(rows: DtRowInput[], pick: (r: DtRowInput) => unknown): number | null {
  let sum = 0;
  for (const row of rows) {
    const n = Number(pick(row));
    if (!Number.isFinite(n)) return null;
    sum += n;
  }
  return roundMoney(sum);
}

function uniqueInOrder(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function buildGraph31Draft(rows: DtRowInput[]): string {
  const descriptions = uniqueInOrder(rows.map((r) => String(r.description ?? '').trim()));
  const shownDesc = descriptions.slice(0, MAX_G31_DESCRIPTIONS);
  const moreDesc =
    descriptions.length > shownDesc.length
      ? ` (и ещё ${descriptions.length - shownDesc.length} наименований)`
      : '';
  const lines = [shownDesc.join('; ') + moreDesc];

  for (const key of GRAPH31_ATTRIBUTE_ORDER) {
    const values = uniqueInOrder(rows.map((r) => String(r.attributes?.[key] ?? '').trim()));
    if (values.length === 0) continue;
    const shown = values.slice(0, MAX_G31_ATTR_VALUES);
    const more = values.length > shown.length ? `, …` : '';
    lines.push(`${ATTRIBUTE_LABELS[key]}: ${shown.join(', ')}${more}`);
  }
  return lines.join('\n');
}

/**
 * Подсказки по документам графы 44. Коды видов документов — из классификатора
 * (приложение 8 к Решению КТС № 378); указываем только те, в которых уверены.
 */
function buildDocumentHints(report: RegulatoryReport | null | undefined): string[] {
  if (!report) return [];
  const hints: string[] = [];
  const label = (item: RegulatoryItem, fallback: string): string =>
    item.regulation ? `${fallback} ${item.regulation}` : fallback;

  // Код вида документа — из общего словаря G44 (одна точка правды с чек-листом).
  const withCode = (code: string | undefined, text: string): string =>
    code ? `${code} — ${text}` : text;

  const FORM_HINT_LABELS: Record<string, string> = {
    certificate: 'сертификат соответствия',
    declaration: 'декларация о соответствии',
    state_registration: 'свидетельство о государственной регистрации (СГР)',
    notification: 'нотификация (сведения из реестра ЕАЭС)',
  };
  for (const item of report.certifications ?? []) {
    const text = label(item, FORM_HINT_LABELS[item.form] ?? 'подтверждение соответствия');
    hints.push(withCode(G44_CONFORMITY_CODES[item.form], text));
  }
  for (const item of report.permits ?? []) {
    if (item.category !== 'permit_import') continue;
    hints.push(`разрешение на ввоз${item.authority ? ` (${item.authority})` : ''}`);
  }
  for (const item of report.licenses ?? []) {
    if (item.category !== 'license_import') continue;
    hints.push(
      withCode(G44_IMPORT_LICENSE, `лицензия на ввоз${item.authority ? ` (${item.authority})` : ''}`),
    );
  }
  if ((report.utilizationFee ?? []).length > 0) {
    hints.push(withCode(G44_UTILIZATION_FEE, 'расчёт утилизационного сбора'));
  }
  return uniqueInOrder(hints);
}

function buildGoodWarnings(rows: DtRowInput[], good: DtGood): string[] {
  const warnings: string[] = [];
  const report = rows.find((r) => r.regulatoryReport)?.regulatoryReport;

  if ((report?.marking ?? []).length > 0) {
    warnings.push(
      'Обязательная маркировка «Честный знак»: коды идентификации наносятся до выпуска ' +
        'и указываются в графе 31 ДТ (их отсутствие — отказ в регистрации ДТ).',
    );
  }

  for (const item of report?.countryRestrictions ?? []) {
    if (item.category !== 'country_import_ban') continue;
    if (good.countryCode && item.countryCode && item.countryCode !== good.countryCode) continue;
    warnings.push(formatCountryBanWarning(item));
  }

  const hasAntidumping = rows.some((r) => hasAntidumpingNote(r.notes));
  if (hasAntidumping) {
    warnings.push(
      'Антидемпинговая/компенсационная пошлина: страну происхождения потребуется подтвердить ' +
        'сертификатом — без него применяется максимальная ставка.',
    );
  }

  if (good.supplementaryUnit && good.supplementaryQuantity == null) {
    warnings.push(
      `Не хватает количества в доп. единице «${good.supplementaryUnit}» для графы 41 — укажите вручную.`,
    );
  }

  if (good.grossIsEstimated) {
    warnings.push('Вес брутто оценён по нетто (в файле не было колонки брутто) — уточните для графы 35.');
  }

  const problemRows = good.rowNumbers.filter((_, idx) => {
    const status = rows[idx]?.calculationStatus;
    return status === 'error' || status === 'needs_info';
  });
  if (problemRows.length > 0) {
    warnings.push(`Строки ${problemRows.join(', ')} посчитаны не полностью — см. лист «Результат».`);
  }

  return warnings;
}

export function buildDtProject(opts: {
  rows: DtRowInput[];
  /** Страна происхождения документа (OKSMT) — для строк без собственной страны. */
  docCountryOfOrigin: string | null;
  /** Валюта документа (граф 42). */
  currency: string;
  /** Карта курсов «1 единица валюты = X RUB» (Document.exchangeRates). */
  exchangeRates: Record<string, number> | null;
}): DtProject {
  const { rows, currency } = opts;
  const docCountry = normalizeOksmtCode(opts.docCountryOfOrigin);
  const usdPerRub = Number(opts.exchangeRates?.USD);
  const usdRate = Number.isFinite(usdPerRub) && usdPerRub > 0 ? usdPerRub : null;
  const isRub = currency.toUpperCase() === 'RUB';

  // Рублёвая стоимость строки: RUB-документ — значение как есть, иначе — поле *Rub.
  const rubOf = (row: DtRowInput, field: keyof DtRowInput, rubField: keyof DtRowInput): unknown =>
    isRub ? row[field] : row[rubField];

  const groups = new Map<string, { rows: DtRowInput[]; rowNumbers: number[] }>();
  const unassignedRows: number[] = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const code = String(row.tnVedCode ?? '').trim();
    if (!code) {
      unassignedRows.push(i + 1);
      continue;
    }
    const country = normalizeOksmtCode(row.countryOfOrigin) ?? docCountry;
    const key = `${code}\x1F${country ?? ''}`;
    let group = groups.get(key);
    if (!group) {
      group = { rows: [], rowNumbers: [] };
      groups.set(key, group);
    }
    group.rows.push(row);
    group.rowNumbers.push(i + 1);
  }

  const goods: DtGood[] = [];
  for (const [key, group] of groups) {
    const [tnVedCode, countryCode] = key.split('\x1F');
    const country = countryCode || null;

    let netWeightKg = 0;
    let grossWeightKg = 0;
    let grossIsEstimated = false;
    for (const row of group.rows) {
      const qty = num(row.quantity);
      const net = num(row.weight) * qty;
      netWeightKg += net;
      const grossPerUnit = Number(row.weightGross);
      if (Number.isFinite(grossPerUnit) && grossPerUnit > 0) {
        grossWeightKg += grossPerUnit * qty;
      } else {
        grossWeightKg += net;
        grossIsEstimated = true;
      }
    }

    const supplementaryUnit =
      group.rows.map((r) => r.supplementaryUnit).find((u) => !!u) ?? null;
    let supplementaryQuantity: number | null = null;
    if (supplementaryUnit) {
      let sum = 0;
      let complete = true;
      for (const row of group.rows) {
        // null/undefined — «данных нет» (Number(null)=0 замаскировал бы пропуск).
        const q = row.supplementaryQuantity == null ? NaN : Number(row.supplementaryQuantity);
        if (!Number.isFinite(q)) {
          complete = false;
          break;
        }
        sum += q;
      }
      supplementaryQuantity = complete ? round4(sum) : null;
    }

    const invoiceValue = roundMoney(group.rows.reduce((s, r) => s + num(r.totalPrice), 0));
    const customsValue = roundMoney(
      group.rows.reduce((s, r) => s + num(r.totalPrice) + num(r.freightShare), 0),
    );
    const totalPriceRub = sumOrNull(group.rows, (r) => rubOf(r, 'totalPrice', 'totalPriceRub'));
    // undefined (не null!) помечает «неизвестно»: Number(null)=0 маскировал бы пропуск.
    const freightRub = sumOrNull(group.rows, (r) =>
      isRub
        ? (r.freightShare ?? 0)
        : // freightShareRub у legacy-строк отсутствует при нулевом фрахте — трактуем как 0.
          (r.freightShareRub ?? (num(r.freightShare) === 0 ? 0 : undefined)),
    );
    const customsValueRub =
      totalPriceRub != null && freightRub != null ? roundMoney(totalPriceRub + freightRub) : null;

    const statisticalValueUsd =
      currency.toUpperCase() === 'USD'
        ? customsValue
        : customsValueRub != null && usdRate
          ? roundMoney(customsValueRub / usdRate)
          : null;

    const good: DtGood = {
      goodNumber: 0, // проставим после сортировки
      tnVedCode,
      countryCode: country,
      countryName: country ? (OKSMT_BY_CODE.get(country)?.nameRu ?? null) : null,
      rowNumbers: group.rowNumbers,
      descriptionDraft: buildGraph31Draft(group.rows),
      grossWeightKg: round3(grossWeightKg),
      grossIsEstimated,
      netWeightKg: round3(netWeightKg),
      supplementaryUnit,
      supplementaryQuantity,
      invoiceValue,
      customsValue,
      customsValueRub,
      statisticalValueUsd,
      dutyRub: sumOrNull(group.rows, (r) => rubOf(r, 'dutyAmount', 'dutyAmountRub')),
      exciseRub: sumOrNull(group.rows, (r) => rubOf(r, 'exciseAmount', 'exciseAmountRub')),
      vatRub: sumOrNull(group.rows, (r) => rubOf(r, 'vatAmount', 'vatAmountRub')),
      itcUsdPerKg: null,
      documentHints: buildDocumentHints(group.rows.find((r) => r.regulatoryReport)?.regulatoryReport),
      warnings: [],
    };
    if (good.statisticalValueUsd != null && good.netWeightKg > 0) {
      good.itcUsdPerKg = roundMoney(good.statisticalValueUsd / good.netWeightKg);
    }
    good.warnings = buildGoodWarnings(group.rows, good);
    goods.push(good);
  }

  // Порядок товаров — по первой строке листа «Результат», чтобы номера были предсказуемы.
  goods.sort((a, b) => a.rowNumbers[0] - b.rowNumbers[0]);
  goods.forEach((g, i) => {
    g.goodNumber = i + 1;
  });

  const totalCustomsValue = roundMoney(goods.reduce((s, g) => s + g.customsValue, 0));
  const totalCustomsValueRub = goods.every((g) => g.customsValueRub != null)
    ? roundMoney(goods.reduce((s, g) => s + (g.customsValueRub ?? 0), 0))
    : null;
  const totalStatisticalUsd = goods.every((g) => g.statisticalValueUsd != null)
    ? roundMoney(goods.reduce((s, g) => s + (g.statisticalValueUsd ?? 0), 0))
    : null;

  const warnings: string[] = [];
  if (unassignedRows.length > 0) {
    warnings.push(
      `Строки ${unassignedRows.join(', ')} без кода ТН ВЭД — в товары ДТ не вошли, суммы ниже неполные.`,
    );
  }
  const needsDts1 =
    totalStatisticalUsd == null ? null : totalStatisticalUsd > DTS_EXEMPTION_THRESHOLD_USD;
  if (needsDts1) {
    warnings.push(
      `Таможенная стоимость партии ≈ $${Math.round(totalStatisticalUsd!).toLocaleString('en-US')} ` +
        `(> эквивалента $10 000) — потребуется ДТС-1 (Решение ЕЭК № 160). ` +
        `Для многоразовых/повторяющихся поставок ДТС обязательна и при меньшей стоимости.`,
    );
  }
  if (goods.length > 999) {
    warnings.push(`Товаров ${goods.length} — в одну ДТ помещается не более 999, партию придётся делить.`);
  }

  return {
    goods,
    unassignedRows,
    totals: {
      customsValue: totalCustomsValue,
      customsValueRub: totalCustomsValueRub,
      statisticalValueUsd: totalStatisticalUsd,
      customsFeeRub: estimateCustomsFeeRub(totalCustomsValueRub),
      needsDts1,
    },
    warnings,
  };
}
