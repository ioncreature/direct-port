import { Injectable, Logger } from '@nestjs/common';
import type { ClassifiedProduct } from '../classifier/classifier.service';
import { DEFAULT_CONFIDENCE_THRESHOLD } from '../common/confidence';
import { isSpecificDutyUnit } from '../common/normalize-impedi';
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

function formatMethod(method: ChargeMethod): string {
  switch (method.kind) {
    case 'ad_valorem':
    case 'fixed_rate':
      return `${trimNumber(method.rate)}%`;
    case 'specific':
      return `${trimNumber(method.amount)} €/${humanizeUnit(method.per)}`;
    case 'combined_min':
      return `${trimNumber(method.rate)}% ≥ ${trimNumber(method.specificAmount)} €/${humanizeUnit(method.per)}`;
    case 'combined_max':
      return `${trimNumber(method.rate)}% ≤ ${trimNumber(method.specificAmount)} €/${humanizeUnit(method.per)}`;
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
    options?: { eurToDoc?: number; confidenceThreshold?: number },
  ): CalculationSummary {
    const threshold = options?.confidenceThreshold ?? DEFAULT_CONFIDENCE_THRESHOLD;
    const currencyRates = { eurToDoc: options?.eurToDoc ?? 1 };
    this.logger.log(
      `Calculating ${products.length} products, commission: ${JSON.stringify(commission)}, eurToDoc=${currencyRates.eurToDoc}, confidenceThreshold=${threshold}`,
    );
    const items = products.map((p) => this.calculateOne(p, commission, currencyRates, threshold));
    const summary = this.summarize(items);
    this.logger.log(`Calculation done: grandTotal=${summary.grandTotal.toFixed(2)}, duty=${summary.totalDuty.toFixed(2)}, vat=${summary.totalVat.toFixed(2)}`);
    return summary;
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
    currencyRates: { eurToDoc: number },
    confidenceThreshold: number,
  ): CalculatedProduct {
    const notes: ProductNote[] = [...p.notes];
    const totalPrice = p.price * p.quantity;

    // Источник правил: AI-интерпретация либо детерминистический fallback из полей TKS.
    // НДС всегда синхронизируется с rates.NDS (AI-интерпретация может быть неверной,
    // например, после повышения стандартной ставки в РФ до 22% с 2026 г.).
    const usingFallback = !p.dutyInterpretation?.charges.length;
    const charges: DutyChargeRule[] = this.ensureAuthoritativeVatRate(
      usingFallback ? this.buildChargesFromRates(p) : p.dutyInterpretation!.charges,
      p.vatRate,
    );

    // Fallback не умеет совмещать две specific-составляющие (например, IMP=0.5 EUR/пар + IMP2=2 EUR/кг).
    // Берём только IMP и помечаем результат как неполный — иначе IMP2 тихо теряется.
    if (
      usingFallback &&
      isSpecificDutyUnit(p.dutyRateUnit) &&
      p.dutyMin != null &&
      p.dutyMin > 0 &&
      !!p.dutyMinUnit
    ) {
      notes.push({
        stage: 'interpret',
        severity: 'blocker',
        field: 'duty',
        message:
          `Комбинированная ставка с двумя специфическими составляющими (${p.dutyRate} ${p.dutyRateUnit} ${p.dutySign ?? ''} ${p.dutyMin} ${p.dutyMinUnit}) не поддерживается детерминистическим расчётом. Учтена только первая часть; для корректного расчёта требуется AI-интерпретатор.`.trim(),
      });
    }

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
    const hasAdValorem = !impIsSpecific && p.dutyRate > 0;
    const hasImpSpecific = impIsSpecific && p.dutyRate > 0;
    const hasImp2Spec = p.dutyMin != null && p.dutyMin > 0 && !!p.dutyMinUnit;

    if (hasAdValorem || hasImpSpecific || hasImp2Spec) {
      let method: ChargeMethod;

      if (hasAdValorem && hasImp2Spec) {
        const per = normalizePer(p.dutyMinUnit!);
        // Пустой IMPSIGN или '>' трактуем как combined_min ("но не менее")
        method = {
          kind: p.dutySign === '<' ? 'combined_max' : 'combined_min',
          rate: p.dutyRate,
          specificAmount: p.dutyMin!,
          unit: 'EUR',
          per,
        };
      } else if (hasImpSpecific) {
        method = {
          kind: 'specific',
          amount: p.dutyRate,
          unit: 'EUR',
          per: normalizePer(p.dutyRateUnit!),
        };
      } else if (hasImp2Spec) {
        method = {
          kind: 'specific',
          amount: p.dutyMin!,
          unit: 'EUR',
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

  private resolveMethod(
    method: ChargeMethod,
    baseValue: number,
    product: CalculatorInput,
    currencyRates?: { eurToDoc: number },
  ): MethodResult {
    const eurToDoc = currencyRates?.eurToDoc ?? 1;

    switch (method.kind) {
      case 'ad_valorem':
      case 'fixed_rate':
        return { amount: baseValue * (method.rate / 100), base: null, estimated: false };

      case 'specific': {
        const per = normalizePer(method.per);
        const qty = this.resolveQuantity(per, product);
        if (qty.found) {
          return {
            amount: method.amount * eurToDoc * qty.qty,
            base: per,
            estimated: false,
          };
        }
        return {
          amount: 0,
          base: per,
          estimated: true,
          formula: `${describeQuantity(per)} × ${method.amount} ${method.unit} × ${eurToDoc.toFixed(4)} (курс ${method.unit} в валюте документа)`,
          blockerMessage: `Для расчёта пошлины требуется ${describeQuantity(per)} товара. Пошлина = (${describeQuantity(per)}) × ${method.amount} ${method.unit} / единицу.`,
        };
      }

      case 'combined_min': {
        const adValorem = baseValue * (method.rate / 100);
        const per = normalizePer(method.per);
        const qty = this.resolveQuantity(per, product);
        if (qty.found) {
          const specific = method.specificAmount * eurToDoc * qty.qty;
          return { amount: Math.max(adValorem, specific), base: per, estimated: false };
        }
        return {
          amount: adValorem, // применяем хотя бы адвалорную часть как нижнюю оценку
          base: per,
          estimated: true,
          formula: `max(${adValorem.toFixed(2)}; ${describeQuantity(per)} × ${method.specificAmount} ${method.unit} × ${eurToDoc.toFixed(4)})`,
          blockerMessage: `Комбинированная ставка: ${method.rate}% ИЛИ ${method.specificAmount} ${method.unit}/${describeQuantity(per)} (что больше). Для точного расчёта требуется ${describeQuantity(per)}. Сейчас применена только адвалорная часть — реальная пошлина может быть выше.`,
        };
      }

      case 'combined_max': {
        const adValorem = baseValue * (method.rate / 100);
        const per = normalizePer(method.per);
        const qty = this.resolveQuantity(per, product);
        if (qty.found) {
          const specific = method.specificAmount * eurToDoc * qty.qty;
          return { amount: Math.min(adValorem, specific), base: per, estimated: false };
        }
        return {
          amount: adValorem, // верхняя граница — адвалорная часть (specific могла бы её уменьшить)
          base: per,
          estimated: true,
          formula: `min(${adValorem.toFixed(2)}; ${describeQuantity(per)} × ${method.specificAmount} ${method.unit} × ${eurToDoc.toFixed(4)})`,
          blockerMessage: `Комбинированная ставка: ${method.rate}% ИЛИ ${method.specificAmount} ${method.unit}/${describeQuantity(per)} (что меньше). Для точного расчёта требуется ${describeQuantity(per)}. Сейчас применена адвалорная часть как верхняя граница.`,
        };
      }
    }
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
