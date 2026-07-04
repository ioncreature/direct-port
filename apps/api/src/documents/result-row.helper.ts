import type { CalculatedProduct } from '../calculator/calculator.service';
import type { CodeCandidate, MissingDataCategory } from '../classifier/classifier.service';
import type { DutyInterpretation } from '../duty-interpreter/interfaces';
import { roundMoney } from '../common/money';

export interface ResultRowConversion {
  exchangeRate: number;
  toRub: (value: number) => number;
}

/**
 * Сериализует CalculatedProduct в plain-объект для JSONB-колонки `Document.resultData`.
 * Используется и в основном pipeline (`DocumentsProcessor`), и при ручной правке кода
 * оператором (`ManualCodeService`) — чтобы формат строки в БД оставался единообразным
 * между этими путями. При смене формата правь только здесь.
 */
export function buildResultRow(opts: {
  item: CalculatedProduct;
  dutyInterpretation: DutyInterpretation | null;
  candidateCodes: CodeCandidate[] | null;
  missingDataCategories: MissingDataCategory[] | null;
  conversion: ResultRowConversion | null;
}): Record<string, unknown> {
  const { item, dutyInterpretation, candidateCodes, missingDataCategories, conversion } = opts;
  const base: Record<string, unknown> = {
    description: item.description,
    quantity: item.quantity,
    price: item.price,
    weight: item.weight,
    weightGross: item.weightGross ?? null,
    dimensions: item.dimensions ?? null,
    attributes: item.attributes ?? null,
    tnVedCode: item.tnVedCode,
    tnVedDescription: item.tnVedDescription,
    dutyRate: item.dutyRate,
    dutyRateUnit: item.dutyRateUnit,
    dutySign: item.dutySign,
    dutyMin: item.dutyMin,
    dutyMinUnit: item.dutyMinUnit,
    dutyRateDisplay: item.dutyRateDisplay,
    vatRate: item.vatRate,
    exciseRate: item.exciseRate,
    supplementaryUnit: item.supplementaryUnit ?? null,
    supplementaryQuantity: item.supplementaryQuantity ?? null,
    countryOfOrigin: item.countryOfOrigin ?? null,
    matched: item.matched,
    suggestedCode: item.suggestedCode,
    dutyInterpretation,
    totalPrice: item.totalPrice,
    freightShare: item.freightShare,
    dutyAmount: item.dutyAmount,
    dutyAmountIsEstimate: item.dutyAmountIsEstimate,
    dutyFormula: item.dutyFormula,
    dutyBase: item.dutyBase,
    vatAmount: item.vatAmount,
    exciseAmount: item.exciseAmount,
    logisticsCommission: item.logisticsCommission,
    totalCost: item.totalCost,
    verificationStatus: item.verificationStatus,
    calculationStatus: item.calculationStatus,
    matchConfidence: item.matchConfidence,
    verified: item.verified,
    verificationComment: item.verificationComment,
    candidateCodes,
    missingDataCategories,
    notes: item.notes,
    regulatoryReport: item.regulatoryReport ?? null,
  };
  if (!conversion) return base;
  return { ...base, ...buildRubFields(item, conversion) };
}

/**
 * Конвертирует денежные поля позиции в рубли. Каждый компонент округляется независимо,
 * а totalCostRub собирается как сумма уже округлённых компонентов — тогда он точно равен
 * сумме построчных рублёвых значений (#4), а не отдельному округлению totalCost × rate.
 * Общий блок для основного pipeline (через buildResultRow) и для recalculate в processor.
 */
export function buildRubFields(
  item: CalculatedProduct,
  conversion: ResultRowConversion,
): Record<string, number> {
  const { exchangeRate, toRub } = conversion;
  const totalPriceRub = toRub(item.totalPrice);
  const freightShareRub = toRub(item.freightShare);
  const dutyAmountRub = toRub(item.dutyAmount);
  const vatAmountRub = toRub(item.vatAmount);
  const exciseAmountRub = toRub(item.exciseAmount);
  const logisticsCommissionRub = toRub(item.logisticsCommission);
  return {
    totalPriceRub,
    freightShareRub,
    dutyAmountRub,
    vatAmountRub,
    exciseAmountRub,
    logisticsCommissionRub,
    totalCostRub: roundMoney(
      totalPriceRub +
        freightShareRub +
        dutyAmountRub +
        vatAmountRub +
        exciseAmountRub +
        logisticsCommissionRub,
    ),
    exchangeRate,
  };
}
