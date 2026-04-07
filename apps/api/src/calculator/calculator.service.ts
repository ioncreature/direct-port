import { Injectable } from '@nestjs/common';
import type { ClassifiedProduct } from '../classifier/classifier.service';

export interface CalculatedProduct extends ClassifiedProduct {
  totalPrice: number;
  dutyAmount: number;
  vatAmount: number;
  exciseAmount: number;
  logisticsCommission: number;
  totalCost: number;
  /** 'exact' — точное совпадение, 'review' — требует ручной проверки */
  verificationStatus: 'exact' | 'review';
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

/** Порог уверенности для точного совпадения (70%) */
const CONFIDENCE_THRESHOLD = 0.7;

@Injectable()
export class CalculatorService {
  calculate(products: ClassifiedProduct[], commission: CommissionConfig = DEFAULT_COMMISSION): CalculationSummary {
    const items = products.map((p) => this.calculateOne(p, commission));

    return {
      items,
      totalDuty: items.reduce((s, i) => s + i.dutyAmount, 0),
      totalVat: items.reduce((s, i) => s + i.vatAmount, 0),
      totalExcise: items.reduce((s, i) => s + i.exciseAmount, 0),
      totalLogistics: items.reduce((s, i) => s + i.logisticsCommission, 0),
      grandTotal: items.reduce((s, i) => s + i.totalCost, 0),
    };
  }

  private calculateOne(p: ClassifiedProduct, commission: CommissionConfig): CalculatedProduct {
    const totalPrice = p.price * p.quantity;

    let dutyAmount = totalPrice * (p.dutyRate / 100);

    // Комбинированная ставка: "X%, но не менее Y EUR/кг"
    if (p.dutySign === '>' && p.dutyMin != null && p.weight > 0) {
      const minDuty = p.dutyMin * p.weight * p.quantity;
      dutyAmount = Math.max(dutyAmount, minDuty);
    }

    const exciseAmount = totalPrice * (p.exciseRate / 100);
    const vatAmount = (totalPrice + dutyAmount + exciseAmount) * (p.vatRate / 100);

    const logisticsCommission =
      totalPrice * (commission.pricePercent / 100) +
      p.weight * p.quantity * commission.weightRate +
      commission.fixedFee;

    const totalCost = totalPrice + dutyAmount + vatAmount + exciseAmount + logisticsCommission;

    const verificationStatus: 'exact' | 'review' =
      p.matched && p.matchConfidence >= CONFIDENCE_THRESHOLD ? 'exact' : 'review';

    return {
      ...p,
      totalPrice,
      dutyAmount,
      vatAmount,
      exciseAmount,
      logisticsCommission,
      totalCost,
      verificationStatus,
    };
  }
}
