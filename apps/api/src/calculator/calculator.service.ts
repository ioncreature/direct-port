import { Injectable, Logger } from '@nestjs/common';
import type { ClassifiedProduct } from '../classifier/classifier.service';
import { DEFAULT_CONFIDENCE_THRESHOLD } from '../common/confidence';
import { extractCurrency, isFlatCurrencyUnit, isSpecificDutyUnit } from '../common/normalize-impedi';
import { normalizeOksmtCode } from '../common/oksmt';
import {
  resolveCalculationStatus,
  type CalculationStatus,
  type ProductNote,
} from '../common/product-notes';
import type {
  BaseType,
  ChargeMethod,
  DutyChargeRule,
  DutyInterpretation,
  SpecificPart,
} from '../duty-interpreter/interfaces';

/**
 * Вход калькулятора. Обычно это InterpretedProduct (после duty-interpreter),
 * но калькулятор ничего не ломает, если dutyInterpretation отсутствует — тогда
 * строится детерминистический fallback из базовых полей TKS.
 */
export type CalculatorInput = ClassifiedProduct & {
  dutyInterpretation?: DutyInterpretation | null;
};

export interface CalculatedProduct extends ClassifiedProduct {
  totalPrice: number;
  dutyAmount: number;
  /** true если dutyAmount — неполная оценка (например, применена только адвалорная часть комбинированной ставки) */
  dutyAmountIsEstimate: boolean;
  /** Текст формулы для специфических ставок, когда не хватило размеров для точного расчёта */
  dutyFormula: string | null;
  /** Каноническая единица базы специфической пошлины: 'kg' | 'm2' | 'pcs' | 'l' | 'm3' | null */
  dutyBase: string | null;
  /** Человекочитаемая ставка пошлины: "10%", "0.34 €/пара", "10% ≥ 0.34 €/пара" */
  dutyRateDisplay: string;
  vatAmount: number;
  exciseAmount: number;
  logisticsCommission: number;
  totalCost: number;
  /** Устаревшее поле, остаётся для обратной совместимости. Выводит только качество матча TKS. */
  verificationStatus: 'exact' | 'review';
  /** Итоговый статус расчёта, выведенный из notes: exact / partial / needs_info / error */
  calculationStatus: CalculationStatus;
  notes: ProductNote[];
}

export interface CalculationSummary {
  items: CalculatedProduct[];
  totalDuty: number;
  totalVat: number;
  totalExcise: number;
  totalLogistics: number;
  grandTotal: number;
}

export interface CommissionConfig {
  pricePercent: number;
  weightRate: number;
  fixedFee: number;
}

const DEFAULT_COMMISSION: CommissionConfig = {
  pricePercent: 5,
  weightRate: 0,
  fixedFee: 0,
};

/**
 * Таблица единиц: canonical → [человекочитаемое_описание, aliases...].
 * Aliases нормализуются из TKS (кг, шт, 1000шт, см³) и Claude (kg, pcs, cc).
 * k-префикс означает «за тысячу» (kpcs=1000шт, kl=1000л, km3=1000м³).
 *
 * Редкие единицы из OKEI (ethanol_l, gross_mass_t, load_capacity_t, capacity_m3)
 * не выводятся из price/weight/quantity — их значение должно приходить через
 * product.dimensions (пользователь указывает вместимость, полную массу и т. д.).
 */
const UNITS: Record<string, { label: string; aliases: string[] }> = {
  kg: { label: 'вес (кг)', aliases: ['kg', 'кг'] },
  g: { label: 'вес (г)', aliases: ['g', 'г', 'gram', 'грамм'] },
  t: { label: 'вес (т)', aliases: ['t', 'т', 'ton', 'тонна'] },
  ct: { label: 'вес (кар)', aliases: ['кар', 'ct', 'carat', 'карат'] },
  pair: { label: 'количество (пар)', aliases: ['pair', 'pairs', 'пара', 'пар', 'пары'] },
  pcs: { label: 'количество (шт)', aliases: ['pcs', 'unit', 'шт', 'штук', 'штука', 'штуки'] },
  kpcs: { label: 'количество (тыс. шт)', aliases: ['1000шт', '1000pcs', 'kpcs', 'тысшт'] },
  m: { label: 'длина (м)', aliases: ['m', 'м', 'meter', 'metr', 'метр'] },
  m2: { label: 'площадь (м²)', aliases: ['m2', 'м2', 'm²', 'м²', 'квм', 'squaremeter'] },
  m3: { label: 'объём (м³)', aliases: ['m3', 'м3', 'm³', 'м³', 'кубм', 'cubicmeter'] },
  km3: { label: 'объём (тыс. м³)', aliases: ['1000м³', '1000м3', '1000m3', 'km3'] },
  l: { label: 'объём (л)', aliases: ['l', 'л', 'litr', 'litre', 'liter', 'литр'] },
  kl: { label: 'объём (тыс. л)', aliases: ['1000л', '1000l', 'kl'] },
  cm3: { label: 'объём двигателя (см³)', aliases: ['cm3', 'см3', 'см³', 'cc'] },
  kw: { label: 'мощность (кВт)', aliases: ['квт', 'kw', 'kwatt', 'киловатт'] },
  hp: { label: 'мощность (л. с.)', aliases: ['лс', 'л.с', 'hp', 'horsepower', 'лошсила'] },
  ethanol_l: {
    label: 'объём чистого спирта (л 100% спирта)',
    aliases: ['л100%спирта', 'l100%alcohol', 'ethanoll', 'pureethanoll', 'ethanol_l'],
  },
  gross_mass_t: {
    label: 'полная масса (т)',
    aliases: ['тпмассы', 'тпм', 'grossmasst', 'gmasst', 'gross_mass_t'],
  },
  load_capacity_t: {
    label: 'грузоподъёмность (т)',
    aliases: ['тгрп', 'тгрузоподъёмности', 'тгрузоподъемности', 'loadcapacityt', 'load_capacity_t'],
  },
  capacity_m3: {
    label: 'вместимость (м³)',
    aliases: ['м³вок', 'м3вок', 'capacitym3', 'capacity_m3'],
  },
};

const ALIAS_TO_CANONICAL: Record<string, string> = (() => {
  const map: Record<string, string> = {};
  for (const [canonical, { aliases }] of Object.entries(UNITS)) {
    for (const alias of aliases) map[alias] = canonical;
  }
  return map;
})();

export function normalizePer(raw: string | null | undefined): string {
  if (!raw) return '';
  let u = raw.toLowerCase().trim().replace(/[.\s]/g, '');
  const slash = u.indexOf('/');
  if (slash >= 0) u = u.substring(slash + 1);
  return ALIAS_TO_CANONICAL[u] ?? u;
}

function describeQuantity(normalizedPer: string): string {
  return UNITS[normalizedPer]?.label ?? normalizedPer ?? '—';
}

const SHORT_UNIT_LABELS: Record<string, string> = {
  kg: 'кг',
  g: 'г',
  t: 'т',
  ct: 'кар',
  pair: 'пара',
  pcs: 'шт',
  kpcs: '1000 шт',
  m: 'м',
  m2: 'м²',
  m3: 'м³',
  km3: '1000 м³',
  l: 'л',
  kl: '1000 л',
  cm3: 'см³',
  kw: 'кВт',
  hp: 'л.с.',
  ethanol_l: 'л чистого спирта',
  gross_mass_t: 'т полной массы',
  load_capacity_t: 'т грузоподъёмности',
  capacity_m3: 'м³ (вместимость)',
};

/** Короткая человекочитаемая метка единицы: 'kg' → 'кг', null → '—'. */
export function humanizeUnit(per: string | null | undefined): string {
  if (!per) return '—';
  const canonical = normalizePer(per);
  return SHORT_UNIT_LABELS[canonical] ?? canonical;
}

function trimNumber(n: number): string {
  const s = n.toFixed(4);
  return s.replace(/\.?0+$/, '');
}

function formatSpecific(part: SpecificPart | undefined | null): string {
  if (!part) return '—';
  const cur = part.unit === 'EUR' ? '€' : part.unit;
  return `${trimNumber(part.amount)} ${cur}/${humanizeUnit(part.per)}`;
}

function formatMethod(method: ChargeMethod): string {
  switch (method.kind) {
    case 'ad_valorem':
    case 'fixed_rate':
      return `${trimNumber(method.rate)}%`;
    case 'specific':
      return formatSpecific({ amount: method.amount, unit: method.unit, per: method.per });
    case 'combined_min':
      return `${trimNumber(method.rate)}% ≥ ${formatSpecific({ amount: method.specificAmount, unit: method.unit, per: method.per })}`;
    case 'combined_max':
      return `${trimNumber(method.rate)}% ≤ ${formatSpecific({ amount: method.specificAmount, unit: method.unit, per: method.per })}`;
    case 'combined_specific_min':
      return `${formatSpecific(method.primary)} ≥ ${formatSpecific(method.fallback)}`;
    case 'combined_specific_max':
      return `${formatSpecific(method.primary)} ≤ ${formatSpecific(method.fallback)}`;
  }
}

/**
 * Человекочитаемое описание ставки пошлины для отображения в Excel/UI.
 * Берёт все import_duty/antidumping/compensatory/temp_duty charges и соединяет их " + ".
 */
export function formatDutyRate(charges: DutyChargeRule[]): string {
  const dutyCharges = charges.filter(
    (c) => c.type === 'import_duty' || c.type === 'antidumping' || c.type === 'compensatory' || c.type === 'temp_duty',
  );
  if (dutyCharges.length === 0) return '—';
  return dutyCharges.map((c) => formatMethod(c.method)).join(' + ');
}

interface MethodResult {
  amount: number;
  /** Каноническая единица базы для специфической части (или null для чисто адвалорных ставок). */
  base: string | null;
  /** true — в amount применена не вся ставка (не хватило размеров товара). */
  estimated: boolean;
  /** Текст формулы для отображения в Excel при estimated=true. */
  formula?: string;
  /** Сообщение для ProductNote-blocker при estimated=true. */
  blockerMessage?: string;
}

@Injectable()
export class CalculatorService {
  private logger = new Logger(CalculatorService.name);

  calculate(
    products: CalculatorInput[],
    commission: CommissionConfig = DEFAULT_COMMISSION,
    options?: {
      eurToDoc?: number;
      /** Курс «1 единица валюты → единица валюты документа» для каждой валюты.
       *  Если указан currencyToDoc['EUR'], он используется вместо eurToDoc. */
      currencyToDoc?: Record<string, number>;
      confidenceThreshold?: number;
      /** OKSMT-код страны происхождения товаров в документе.
       *  Используется для фильтрации charges с appliesWhen.country. */
      countryOfOrigin?: string | null;
    },
  ): CalculationSummary {
    const threshold = options?.confidenceThreshold ?? DEFAULT_CONFIDENCE_THRESHOLD;
    const currencyRates = this.buildCurrencyRates(options);
    const countryOfOrigin = options?.countryOfOrigin ?? null;
    this.logger.log(
      `Calculating ${products.length} products, commission: ${JSON.stringify(commission)}, rates=${JSON.stringify(currencyRates)}, confidenceThreshold=${threshold}, country=${countryOfOrigin ?? '—'}`,
    );
    const items = products.map((p) => this.calculateOne(p, commission, currencyRates, threshold, countryOfOrigin));
    const summary = this.summarize(items);
    this.logger.log(`Calculation done: grandTotal=${summary.grandTotal.toFixed(2)}, duty=${summary.totalDuty.toFixed(2)}, vat=${summary.totalVat.toFixed(2)}`);
    return summary;
  }

  /**
   * Собирает итоговую карту курсов «валюта → доля валюты документа».
   * Legacy-поле eurToDoc преобразуется в currencyToDoc['EUR'], если последний не задан.
   * Если ни один курс не задан — EUR по умолчанию = 1 (тестовая совместимость).
   */
  private buildCurrencyRates(options?: {
    eurToDoc?: number;
    currencyToDoc?: Record<string, number>;
  }): Record<string, number> {
    const map: Record<string, number> = { ...(options?.currencyToDoc ?? {}) };
    if (options?.eurToDoc != null && map.EUR == null) map.EUR = options.eurToDoc;
    if (map.EUR == null && options?.currencyToDoc == null) map.EUR = 1;
    return map;
  }

  private summarize(items: CalculatedProduct[]): CalculationSummary {
    return {
      items,
      totalDuty: items.reduce((s, i) => s + i.dutyAmount, 0),
      totalVat: items.reduce((s, i) => s + i.vatAmount, 0),
      totalExcise: items.reduce((s, i) => s + i.exciseAmount, 0),
      totalLogistics: items.reduce((s, i) => s + i.logisticsCommission, 0),
      grandTotal: items.reduce((s, i) => s + i.totalCost, 0),
    };
  }

  private calculateOne(
    p: CalculatorInput,
    commission: CommissionConfig,
    currencyRates: Record<string, number>,
    confidenceThreshold: number,
    countryOfOrigin: string | null,
  ): CalculatedProduct {
    const notes: ProductNote[] = [...p.notes];
    const totalPrice = p.price * p.quantity;

    // Источник правил: AI-интерпретация либо детерминистический fallback из полей TKS.
    // НДС всегда синхронизируется с rates.NDS (AI-интерпретация может быть неверной,
    // например, после повышения стандартной ставки в РФ до 22% с 2026 г.).
    const usingFallback = !p.dutyInterpretation?.charges.length;
    const rawCharges: DutyChargeRule[] = this.ensureAuthoritativeVatRate(
      usingFallback ? this.buildChargesFromRates(p) : p.dutyInterpretation!.charges,
      p.vatRate,
    );
    const charges = this.filterChargesByCountry(rawCharges, countryOfOrigin, notes);

    let dutyAmount = 0;
    let exciseAmount = 0;
    let vatAmount = 0;
    let dutyFormula: string | null = null;
    let dutyBase: string | null = null;
    let dutyAmountIsEstimate = false;

    for (const charge of charges) {
      const baseValue = this.resolveBase(charge.base, totalPrice, dutyAmount, exciseAmount);
      const result = this.resolveMethod(charge.method, baseValue, p, currencyRates);

      if (result.estimated && result.blockerMessage) {
        notes.push({
          stage: 'calculate',
          severity: 'blocker',
          field: charge.type,
          message: result.blockerMessage,
        });
      }

      switch (charge.type) {
        case 'import_duty':
        case 'antidumping':
        case 'compensatory':
        case 'temp_duty':
          dutyAmount += result.amount;
          if (charge.type === 'import_duty') {
            if (result.base) dutyBase = result.base;
            if (result.estimated) {
              dutyAmountIsEstimate = true;
              if (result.formula) dutyFormula = result.formula;
            }
          }
          // Для условных ставок (антидемпинговых/компенсационных) показываем условия
          // как warning, чтобы оператор проверил соответствие товара параметрам решения.
          if (
            (charge.type === 'antidumping' || charge.type === 'compensatory') &&
            charge.appliesWhen?.conditions
          ) {
            const label = charge.type === 'antidumping' ? 'антидемпинговая' : 'компенсационная';
            notes.push({
              stage: 'calculate',
              severity: 'warning',
              field: charge.type,
              message: `Применена ${label} пошлина ${formatMethod(charge.method)}. Проверьте соответствие условиям: ${charge.appliesWhen.conditions}`,
            });
          }
          break;
        case 'excise':
          exciseAmount += result.amount;
          break;
        case 'vat':
          vatAmount += result.amount;
          break;
      }
    }

    const logisticsCommission =
      totalPrice * (commission.pricePercent / 100) +
      p.weight * p.quantity * commission.weightRate +
      commission.fixedFee;

    const totalCost = totalPrice + dutyAmount + vatAmount + exciseAmount + logisticsCommission;

    const verificationStatus: 'exact' | 'review' =
      p.matched && p.matchConfidence >= confidenceThreshold ? 'exact' : 'review';

    const calculationStatus = resolveCalculationStatus(notes);
    const dutyRateDisplay = formatDutyRate(charges);

    return {
      ...p,
      totalPrice,
      dutyAmount,
      dutyAmountIsEstimate,
      dutyFormula,
      dutyBase,
      dutyRateDisplay,
      vatAmount,
      exciseAmount,
      logisticsCommission,
      totalCost,
      verificationStatus,
      calculationStatus,
      notes,
    };
  }

  /**
   * Детерминистический fallback: строит набор правил из базовых полей TKS,
   * когда AI-интерпретация недоступна. Работает для простых ставок (чисто адвалорных,
   * чисто специфических и комбинированных с явным IMPSIGN). Результат ВСЕГДА проходит
   * через resolveMethod, поэтому к нему применяются те же проверки размеров и заметки.
   *
   * IMPEDI определяет тип IMP:
   * - null/"%" → IMP это адвалорная ставка в %
   * - "EUR/X" (кг, пар, м² и т.п.) → IMP это специфическая ставка EUR за единицу
   */
  private buildChargesFromRates(p: ClassifiedProduct): DutyChargeRule[] {
    const charges: DutyChargeRule[] = [];

    const impIsSpecific = isSpecificDutyUnit(p.dutyRateUnit);
    const impIsFlatCurrency = isFlatCurrencyUnit(p.dutyRateUnit);
    const hasAdValorem = !impIsSpecific && !impIsFlatCurrency && p.dutyRate > 0;
    const hasImpSpecific = impIsSpecific && p.dutyRate > 0;
    const hasImpFlat = impIsFlatCurrency && p.dutyRate > 0;
    const hasImp2Spec = p.dutyMin != null && p.dutyMin > 0 && !!p.dutyMinUnit;

    if (hasAdValorem || hasImpSpecific || hasImpFlat || hasImp2Spec) {
      let method: ChargeMethod;
      const impCurrency = extractCurrency(p.dutyRateUnit) ?? 'EUR';
      const imp2Currency = extractCurrency(p.dutyMinUnit) ?? 'EUR';

      if (hasImpFlat) {
        // Фиксированная сумма X валюты за штуку (IMPEDI=500/643). AI-интерпретатор
        // уточнит, если семантика иная (например, за декларацию).
        method = {
          kind: 'specific',
          amount: p.dutyRate,
          unit: impCurrency,
          per: 'pcs',
        };
      } else if (hasImpSpecific && hasImp2Spec) {
        // Две specific-составляющих: "0.5 EUR/пар но не менее 2 EUR/кг".
        method = {
          kind: p.dutySign === '<' ? 'combined_specific_max' : 'combined_specific_min',
          primary: {
            amount: p.dutyRate,
            unit: impCurrency,
            per: normalizePer(p.dutyRateUnit!),
          },
          fallback: {
            amount: p.dutyMin!,
            unit: imp2Currency,
            per: normalizePer(p.dutyMinUnit!),
          },
        };
      } else if (hasAdValorem && hasImp2Spec) {
        const per = normalizePer(p.dutyMinUnit!);
        // Пустой IMPSIGN или '>' трактуем как combined_min ("но не менее")
        method = {
          kind: p.dutySign === '<' ? 'combined_max' : 'combined_min',
          rate: p.dutyRate,
          specificAmount: p.dutyMin!,
          unit: imp2Currency,
          per,
        };
      } else if (hasImpSpecific) {
        method = {
          kind: 'specific',
          amount: p.dutyRate,
          unit: impCurrency,
          per: normalizePer(p.dutyRateUnit!),
        };
      } else if (hasImp2Spec) {
        method = {
          kind: 'specific',
          amount: p.dutyMin!,
          unit: imp2Currency,
          per: normalizePer(p.dutyMinUnit!),
        };
      } else {
        method = { kind: 'ad_valorem', rate: p.dutyRate };
      }

      charges.push({
        type: 'import_duty',
        label: 'Ввозная пошлина',
        method,
        base: 'customs_value',
      });
    }

    if (p.exciseRate > 0) {
      charges.push({
        type: 'excise',
        label: 'Акциз',
        method: { kind: 'ad_valorem', rate: p.exciseRate },
        base: 'customs_value',
      });
    }

    if (p.vatRate > 0) {
      charges.push({
        type: 'vat',
        label: 'НДС',
        method: { kind: 'ad_valorem', rate: p.vatRate },
        base: 'customs_value_plus_duty_plus_excise',
      });
    }

    return charges;
  }

  /**
   * Фильтрует charges по стране происхождения документа. Правила:
   *   - charges без appliesWhen.country применяются всегда;
   *   - charges с appliesWhen.country применяются только если страна совпадает;
   *   - если появляется льготная ставка (type='import_duty' с appliesWhen.country),
   *     она заменяет базовую безусловную ввозную пошлину (CU-пошлина по стране
   *     происхождения вытесняет обычную IMP).
   */
  private filterChargesByCountry(
    charges: DutyChargeRule[],
    countryOfOrigin: string | null,
    notes: ProductNote[],
  ): DutyChargeRule[] {
    const normalizedCountry = normalizeOksmtCode(countryOfOrigin);
    const matching: DutyChargeRule[] = [];
    for (const charge of charges) {
      const chargeCountry = charge.appliesWhen?.country;
      if (!chargeCountry) {
        matching.push(charge);
        continue;
      }
      if (normalizeOksmtCode(chargeCountry) === normalizedCountry) {
        matching.push(charge);
      }
    }

    // Льготная ставка по стране (PRIZNAK=30) вытесняет общую адвалорную IMP.
    // Эвристика: если остались несколько 'import_duty', оставляем условную (с country).
    const importDuties = matching.filter((c) => c.type === 'import_duty');
    if (importDuties.length > 1) {
      const preferential = importDuties.find((c) => c.appliesWhen?.country);
      if (preferential) {
        const filtered = matching.filter(
          (c) => c.type !== 'import_duty' || c === preferential,
        );
        notes.push({
          stage: 'calculate',
          severity: 'info',
          field: 'import_duty',
          message: `Применена преференциальная ставка по стране происхождения вместо общей.${preferential.appliesWhen?.conditions ? ` Условия: ${preferential.appliesWhen.conditions}` : ''}`,
        });
        return filtered;
      }
    }
    return matching;
  }

  /**
   * Подменяет ставку НДС в charges на rates.NDS из TKS, чтобы не зависеть от
   * эвристик AI-интерпретатора. NDS в TKS — это непосредственная процентная ставка
   * (после реформы 2026 г. стандартная ставка = 22%).
   */
  private ensureAuthoritativeVatRate(
    charges: DutyChargeRule[],
    vatRate: number,
  ): DutyChargeRule[] {
    if (vatRate <= 0) return charges;
    return charges.map((charge) => {
      if (charge.type !== 'vat' || charge.method.kind !== 'ad_valorem') return charge;
      if (charge.method.rate === vatRate) return charge;
      return {
        ...charge,
        method: { ...charge.method, rate: vatRate },
      };
    });
  }

  private resolveBase(base: BaseType, totalPrice: number, duty: number, excise: number): number {
    switch (base) {
      case 'customs_value_plus_duty':
        return totalPrice + duty;
      case 'customs_value_plus_duty_plus_excise':
        return totalPrice + duty + excise;
      case 'customs_value':
        return totalPrice;
    }
  }

  /**
   * Возвращает курс «1 единица валюты ставки → валюта документа». null — курс неизвестен,
   * конвертация невозможна, ставка должна быть помечена estimated с blocker-note.
   */
  private rateFor(unit: string | undefined, rates: Record<string, number>): number | null {
    const currency = (unit ?? 'EUR').toUpperCase();
    const rate = rates[currency];
    if (rate == null || !Number.isFinite(rate) || rate <= 0) return null;
    return rate;
  }

  private resolveMethod(
    method: ChargeMethod,
    baseValue: number,
    product: CalculatorInput,
    currencyRates: Record<string, number>,
  ): MethodResult {
    switch (method.kind) {
      case 'ad_valorem':
      case 'fixed_rate':
        return { amount: baseValue * (method.rate / 100), base: null, estimated: false };

      case 'specific': {
        const per = normalizePer(method.per);
        const rate = this.rateFor(method.unit, currencyRates);
        const qty = this.resolveQuantity(per, product);
        if (rate == null) {
          return {
            amount: 0,
            base: per,
            estimated: true,
            formula: `${method.amount} ${method.unit}/${describeQuantity(per)} — курс ${method.unit} в валюте документа не получен`,
            blockerMessage: `Специфическая ставка ${method.amount} ${method.unit}/${describeQuantity(per)} не рассчитана: отсутствует курс ${method.unit} в валюте документа.`,
          };
        }
        if (qty.found) {
          return {
            amount: method.amount * rate * qty.qty,
            base: per,
            estimated: false,
          };
        }
        return {
          amount: 0,
          base: per,
          estimated: true,
          formula: `${describeQuantity(per)} × ${method.amount} ${method.unit} × ${rate.toFixed(4)} (курс ${method.unit} в валюте документа)`,
          blockerMessage: `Для расчёта пошлины требуется ${describeQuantity(per)} товара. Пошлина = (${describeQuantity(per)}) × ${method.amount} ${method.unit} / единицу.`,
        };
      }

      case 'combined_min':
      case 'combined_max':
        return this.resolveCombinedAdValoremSpecific(method, baseValue, product, currencyRates);

      case 'combined_specific_min':
      case 'combined_specific_max':
        return this.resolveCombinedSpecific(method, product, currencyRates);
    }
  }

  /** Ad valorem + specific с выбором max/min. '>'/combined_min — max, '<'/combined_max — min. */
  private resolveCombinedAdValoremSpecific(
    method: Extract<ChargeMethod, { kind: 'combined_min' | 'combined_max' }>,
    baseValue: number,
    product: CalculatorInput,
    currencyRates: Record<string, number>,
  ): MethodResult {
    const isMin = method.kind === 'combined_min';
    const adValorem = baseValue * (method.rate / 100);
    const per = normalizePer(method.per);
    const rate = this.rateFor(method.unit, currencyRates);
    const qty = this.resolveQuantity(per, product);

    if (rate != null && qty.found) {
      const specific = method.specificAmount * rate * qty.qty;
      const amount = isMin ? Math.max(adValorem, specific) : Math.min(adValorem, specific);
      return { amount, base: per, estimated: false };
    }

    const op = isMin ? 'max' : 'min';
    const compare = isMin ? 'больше' : 'меньше';
    const boundary = isMin ? 'только адвалорная часть — реальная пошлина может быть выше' : 'адвалорная часть как верхняя граница';
    const rateNote = rate == null ? ` (курс ${method.unit} в валюте документа отсутствует)` : '';
    const rateForFormula = rate ?? 0;

    return {
      amount: adValorem,
      base: per,
      estimated: true,
      formula: `${op}(${adValorem.toFixed(2)}; ${describeQuantity(per)} × ${method.specificAmount} ${method.unit} × ${rateForFormula.toFixed(4)})`,
      blockerMessage: `Комбинированная ставка: ${method.rate}% ИЛИ ${method.specificAmount} ${method.unit}/${describeQuantity(per)} (что ${compare}). Применена ${boundary}${rateNote || `; не хватает ${describeQuantity(per)}`}.`,
    };
  }

  /** Две specific-составляющие в разных единицах: выбираем max/min после конвертации в валюту документа. */
  private resolveCombinedSpecific(
    method: Extract<ChargeMethod, { kind: 'combined_specific_min' | 'combined_specific_max' }>,
    product: CalculatorInput,
    rates: Record<string, number>,
  ): MethodResult {
    const isMin = method.kind === 'combined_specific_min';
    const primaryPer = normalizePer(method.primary?.per ?? '');
    const fallbackPer = normalizePer(method.fallback?.per ?? '');
    const p1 = this.evalSpecific(method.primary, product, rates);
    const p2 = this.evalSpecific(method.fallback, product, rates);

    if (p1.ok && p2.ok) {
      const amount = isMin ? Math.max(p1.amount, p2.amount) : Math.min(p1.amount, p2.amount);
      return { amount, base: primaryPer, estimated: false };
    }

    // base должна отражать единицу *фактически применённой* составляющей, иначе
    // Excel/UI покажут базу пошлины, не соответствующую посчитанной сумме.
    const fallbackAmount = p1.ok ? p1.amount : p2.ok ? p2.amount : 0;
    const appliedPer = p1.ok ? primaryPer : p2.ok ? fallbackPer : primaryPer || fallbackPer;
    const missing: string[] = [];
    if (!p1.ok) missing.push(`${formatSpecific(method.primary)} (${p1.reason})`);
    if (!p2.ok) missing.push(`${formatSpecific(method.fallback)} (${p2.reason})`);
    const op = isMin ? 'но не менее' : 'но не более';
    const display = `${formatSpecific(method.primary)} ${op} ${formatSpecific(method.fallback)}`;
    return {
      amount: fallbackAmount,
      base: appliedPer,
      estimated: true,
      formula: display,
      blockerMessage: `Комбинированная ставка из двух специфических составляющих (${display}) не посчитана точно: ${missing.join(', ')}.`,
    };
  }

  private evalSpecific(
    part: SpecificPart | undefined,
    product: CalculatorInput,
    rates: Record<string, number>,
  ): { ok: true; amount: number } | { ok: false; reason: string } {
    if (!part || typeof part.amount !== 'number' || !part.unit || !part.per) {
      return { ok: false, reason: 'неполные данные ставки' };
    }
    const per = normalizePer(part.per);
    const rate = this.rateFor(part.unit, rates);
    if (rate == null) return { ok: false, reason: `нет курса ${part.unit}` };
    const qty = this.resolveQuantity(per, product);
    if (!qty.found) return { ok: false, reason: `нет ${describeQuantity(per)}` };
    return { ok: true, amount: part.amount * rate * qty.qty };
  }

  /**
   * Находит количество/размер товара для указанной канонической единицы. Никогда не
   * подменяет одну размерность другой — иначе ставка "0,38 EUR/м² × вес" считалась бы
   * по весу вместо площади.
   */
  private resolveQuantity(
    normalizedPer: string,
    product: CalculatorInput,
  ): { qty: number; found: true } | { qty: 0; found: false } {
    const { weight, quantity } = product;

    // Вес: product.weight хранится в кг — конвертируем в нужную единицу
    if (normalizedPer === 'kg' && weight > 0) return { qty: weight * quantity, found: true };
    if (normalizedPer === 'g' && weight > 0) return { qty: weight * 1000 * quantity, found: true };
    if (normalizedPer === 't' && weight > 0) return { qty: (weight / 1000) * quantity, found: true };

    // Количество: «пара» и «шт» эквивалентны в декларации; 1000шт — делим на 1000
    if ((normalizedPer === 'pcs' || normalizedPer === 'pair') && quantity > 0)
      return { qty: quantity, found: true };
    if (normalizedPer === 'kpcs' && quantity > 0) return { qty: quantity / 1000, found: true };

    // Размеры (m, m2, m3, l, cm3, kw, hp, ct, ...): из dimensions
    const dim = product.dimensions?.find((d) => normalizePer(d.unit) === normalizedPer);
    if (dim && Number.isFinite(dim.value) && dim.value > 0) {
      return { qty: dim.value * quantity, found: true };
    }
    return { qty: 0, found: false };
  }
}
