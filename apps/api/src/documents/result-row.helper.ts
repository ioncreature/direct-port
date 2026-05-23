import type { CalculatedProduct } from '../calculator/calculator.service';
import type { CodeCandidate, MissingDataCategory } from '../classifier/classifier.service';
import type { DutyInterpretation } from '../duty-interpreter/interfaces';

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
    dimensions: item.dimensions ?? null,
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
  const { exchangeRate, toRub } = conversion;
  return {
    ...base,
    totalPriceRub: toRub(item.totalPrice),
    freightShareRub: toRub(item.freightShare),
    dutyAmountRub: toRub(item.dutyAmount),
    vatAmountRub: toRub(item.vatAmount),
    exciseAmountRub: toRub(item.exciseAmount),
    logisticsCommissionRub: toRub(item.logisticsCommission),
    totalCostRub: toRub(item.totalCost),
    exchangeRate,
  };
}
