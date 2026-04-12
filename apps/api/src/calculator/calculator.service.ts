import { Injectable } from '@nestjs/common';
import type { ClassifiedProduct } from '../classifier/classifier.service';
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

const CONFIDENCE_THRESHOLD = 0.7;

/**
 * Приводит единицу измерения из TKS API (кг / шт / м2 / л / м3 / …)
 * или из ответа Claude (kg / pcs / m2 / l / m3 / …) к канонической форме.
 */
export function normalizePer(raw: string | null | undefined): string {
  if (!raw) return '';
  const u = raw.toLowerCase().trim().replace(/[.\s]/g, '');
  if (u === 'kg' || u === 'кг') return 'kg';
  if (u === 'g' || u === 'г' || u === 'gram' || u === 'грамм') return 'g';
  if (u === 't' || u === 'т' || u === 'ton' || u === 'тонна') return 't';
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
    case 'pcs':
      return 'количество (шт)';
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
  calculate(
    products: CalculatorInput[],
    commission: CommissionConfig = DEFAULT_COMMISSION,
    currencyRates?: { eurToDoc: number },
  ): CalculationSummary {
    const items = products.map((p) => this.calculateOne(p, commission, currencyRates));
    return this.summarize(items);
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
    currencyRates?: { eurToDoc: number },
  ): CalculatedProduct {
    const notes: ProductNote[] = [...p.notes];
    const totalPrice = p.price * p.quantity;

    // Источник правил: AI-интерпретация либо детерминистический fallback из полей TKS
    const charges: DutyChargeRule[] = p.dutyInterpretation?.charges.length
      ? p.dutyInterpretation.charges
      : this.buildChargesFromRates(p);

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
      p.matched && p.matchConfidence >= CONFIDENCE_THRESHOLD ? 'exact' : 'review';

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
   */
  private buildChargesFromRates(p: ClassifiedProduct): DutyChargeRule[] {
    const charges: DutyChargeRule[] = [];

    const hasRate = p.dutyRate > 0;
    const hasSpec = p.dutyMin != null && p.dutyMin > 0 && !!p.dutyMinUnit;

    if (hasRate || hasSpec) {
      const per = hasSpec ? normalizePer(p.dutyMinUnit!) : 'kg';
      let method: ChargeMethod;

      if (hasRate && hasSpec) {
        // Комбинированная ставка: адвалорная % + минимум/максимум в EUR за per
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
      } else if (hasSpec) {
        // Только специфическая часть (IMP=0, IMP2=x, IMPEDI2=unit) — это наш случай ковров
        method = { kind: 'specific', amount: p.dutyMin!, unit: 'EUR', per };
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
    if (normalizedPer === 'pcs') {
      if (product.quantity > 0) return { qty: product.quantity, found: true };
      return { qty: 0, found: false };
    }

    const dim = product.dimensions?.find((d) => normalizePer(d.unit) === normalizedPer);
    if (dim && Number.isFinite(dim.value) && dim.value > 0) {
      return { qty: dim.value * product.quantity, found: true };
    }
    return { qty: 0, found: false };
  }
}
