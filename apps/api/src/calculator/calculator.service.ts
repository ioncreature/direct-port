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
 * Приводит единицу измерения из TKS API (кг / шт / м2 / л / м3 / …)
 * или из ответа Claude (kg / pcs / m2 / l / m3 / …) к канонической форме.
 */
export function normalizePer(raw: string | null | undefined): string {
  if (!raw) return '';
  let u = raw.toLowerCase().trim().replace(/[.\s]/g, '');
  const slash = u.indexOf('/');
  if (slash >= 0) u = u.substring(slash + 1);
  if (u === 'kg' || u === 'кг') return 'kg';
  if (u === 'g' || u === 'г' || u === 'gram' || u === 'грамм') return 'g';
  if (u === 't' || u === 'т' || u === 'ton' || u === 'тонна') return 't';
  if (u === 'pair' || u === 'pairs' || u === 'пара' || u === 'пар' || u === 'пары')
    return 'pair';
  // 1000шт — ставка за тысячу штук (ОКЕИ 798, типично для табачных изделий)
  if (u === '1000шт' || u === '1000pcs' || u === 'kpcs' || u === 'тысшт')
    return 'kpcs';
  if (u === 'pcs' || u === 'unit' || u === 'шт' || u === 'штук' || u === 'штука' || u === 'штуки')
    return 'pcs';
  if (u === 'm2' || u === 'м2' || u === 'm²' || u === 'м²' || u === 'квм' || u === 'squaremeter')
    return 'm2';
  if (u === 'm3' || u === 'м3' || u === 'm³' || u === 'м³' || u === 'кубм' || u === 'cubicmeter')
    return 'm3';
  if (u === 'l' || u === 'л' || u === 'litr' || u === 'litre' || u === 'liter' || u === 'литр')
    return 'l';
  return u;
}

/**
 * Человекочитаемое название количества для формулы и заметок.
 * Принимает УЖЕ нормализованную единицу (после normalizePer).
 */
function describeQuantity(normalizedPer: string): string {
  switch (normalizedPer) {
    case 'kg':
      return 'вес (кг)';
    case 'g':
      return 'вес (г)';
    case 't':
      return 'вес (т)';
    case 'pair':
      return 'количество (пар)';
    case 'pcs':
      return 'количество (шт)';
    case 'kpcs':
      return 'количество (тыс. шт)';
    case 'm2':
      return 'площадь (м²)';
    case 'm3':
      return 'объём (м³)';
    case 'l':
      return 'объём (л)';
    default:
      return normalizedPer || '—';
  }
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

    return {
      ...p,
      totalPrice,
      dutyAmount,
      dutyAmountIsEstimate,
      dutyFormula,
      dutyBase,
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
    const hasImpSpecific = impIsSpecific && p.dutyRate > 0 && !!p.dutyRateUnit;
    const hasImp2Spec = p.dutyMin != null && p.dutyMin > 0 && !!p.dutyMinUnit;

    if (hasAdValorem || hasImpSpecific || hasImp2Spec) {
      let method: ChargeMethod;

      if (hasAdValorem && hasImp2Spec) {
        // IMP — адвалорная + IMP2 — специфическая (классическая комбинированная ставка)
        const per = normalizePer(p.dutyMinUnit!);
        if (p.dutySign === '<') {
          method = {
            kind: 'combined_max',
            rate: p.dutyRate,
            specificAmount: p.dutyMin!,
            unit: 'EUR',
            per,
          };
        } else {
          // Пустой или '>' — консервативно берём combined_min ("но не менее")
          method = {
            kind: 'combined_min',
            rate: p.dutyRate,
            specificAmount: p.dutyMin!,
            unit: 'EUR',
            per,
          };
        }
      } else if (hasImpSpecific) {
        // IMP с единицей (IMPEDI=715/166/...) — чистая специфическая ставка (случай обуви: 0.34 EUR/пар)
        method = {
          kind: 'specific',
          amount: p.dutyRate,
          unit: 'EUR',
          per: normalizePer(p.dutyRateUnit!),
        };
      } else if (hasImp2Spec) {
        // Только IMP2 (IMP=0, IMP2=x, IMPEDI2=unit) — случай ковров
        method = {
          kind: 'specific',
          amount: p.dutyMin!,
          unit: 'EUR',
          per: normalizePer(p.dutyMinUnit!),
        };
      } else {
        // Только IMP с процентной единицей (или без неё) — чисто адвалорная
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
   * Находит нужный размер товара для специфической части ставки.
   * Никогда не подставляет вес, если ставка не в кг — это раньше приводило к ошибке
   * "пошлина 0,38 EUR/м² × вес" вместо "0,38 EUR/м² × площадь".
   *
   * `normalizedPer` должен быть уже канонизирован (результат normalizePer).
   */
  private resolveQuantity(
    normalizedPer: string,
    product: CalculatorInput,
  ): { qty: number; found: true } | { qty: 0; found: false } {
    if (normalizedPer === 'kg') {
      if (product.weight > 0) {
        return { qty: product.weight * product.quantity, found: true };
      }
      return { qty: 0, found: false };
    }
    if (normalizedPer === 'pcs' || normalizedPer === 'pair') {
      // «пара» для обуви считается по количеству (одна пара = одна единица товара в декларации)
      if (product.quantity > 0) return { qty: product.quantity, found: true };
      return { qty: 0, found: false };
    }
    if (normalizedPer === 'kpcs') {
      // Ставка указана за 1000 шт — делим количество на 1000
      if (product.quantity > 0) return { qty: product.quantity / 1000, found: true };
      return { qty: 0, found: false };
    }

    const dim = product.dimensions?.find((d) => normalizePer(d.unit) === normalizedPer);
    if (dim && Number.isFinite(dim.value) && dim.value > 0) {
      return { qty: dim.value * product.quantity, found: true };
    }
    return { qty: 0, found: false };
  }
}
