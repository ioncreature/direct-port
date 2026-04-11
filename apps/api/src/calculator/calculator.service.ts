import { Injectable, Logger } from '@nestjs/common';
import type { ClassifiedProduct } from '../classifier/classifier.service';
import type {
  BaseType,
  ChargeMethod,
  Dimension,
  DutyChargeRule,
  InterpretedProduct,
} from '../duty-interpreter/interfaces';

export interface CalculatedProduct extends ClassifiedProduct {
  totalPrice: number;
  dutyAmount: number;
  vatAmount: number;
  exciseAmount: number;
  logisticsCommission: number;
  totalCost: number;
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

const CONFIDENCE_THRESHOLD = 0.7;

@Injectable()
export class CalculatorService {
  private logger = new Logger(CalculatorService.name);

  calculate(
    products: ClassifiedProduct[],
    commission: CommissionConfig = DEFAULT_COMMISSION,
  ): CalculationSummary {
    const items = products.map((p) => this.calculateOne(p, commission));
    return this.summarize(items);
  }

  calculateInterpreted(
    products: InterpretedProduct[],
    commission: CommissionConfig = DEFAULT_COMMISSION,
    currencyRates?: { eurToDoc: number },
  ): CalculationSummary {
    const items = products.map((p) => {
      if (p.dutyInterpretation && p.dutyInterpretation.charges.length > 0) {
        return this.calculateFromRules(p, p.dutyInterpretation.charges, commission, currencyRates);
      }
      return this.calculateOne(p, commission);
    });
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

  private calculateOne(p: ClassifiedProduct, commission: CommissionConfig): CalculatedProduct {
    const totalPrice = p.price * p.quantity;

    let dutyAmount = totalPrice * (p.dutyRate / 100);

    if (p.dutySign === '>' && p.dutyMin != null && p.weight > 0) {
      const minDuty = p.dutyMin * p.weight * p.quantity;
      dutyAmount = Math.max(dutyAmount, minDuty);
    }

    const exciseAmount = totalPrice * (p.exciseRate / 100);
    const vatAmount = (totalPrice + dutyAmount + exciseAmount) * (p.vatRate / 100);

    return this.finalize(p, totalPrice, dutyAmount, vatAmount, exciseAmount, commission);
  }

  private calculateFromRules(
    p: InterpretedProduct,
    charges: DutyChargeRule[],
    commission: CommissionConfig,
    currencyRates?: { eurToDoc: number },
  ): CalculatedProduct {
    const totalPrice = p.price * p.quantity;
    let dutyAmount = 0;
    let exciseAmount = 0;
    let vatAmount = 0;

    for (const charge of charges) {
      const baseValue = this.resolveBase(charge.base, totalPrice, dutyAmount, exciseAmount);
      const amount = this.resolveMethod(charge.method, baseValue, p, currencyRates);

      switch (charge.type) {
        case 'import_duty':
        case 'antidumping':
        case 'compensatory':
        case 'temp_duty':
          dutyAmount += amount;
          break;
        case 'excise':
          exciseAmount += amount;
          break;
        case 'vat':
          vatAmount += amount;
          break;
      }
    }

    return this.finalize(p, totalPrice, dutyAmount, vatAmount, exciseAmount, commission);
  }

  private finalize(
    p: ClassifiedProduct,
    totalPrice: number,
    dutyAmount: number,
    vatAmount: number,
    exciseAmount: number,
    commission: CommissionConfig,
  ): CalculatedProduct {
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
    product: InterpretedProduct,
    currencyRates?: { eurToDoc: number },
  ): number {
    const eurToDoc = currencyRates?.eurToDoc ?? 1;

    switch (method.kind) {
      case 'ad_valorem':
        return baseValue * (method.rate / 100);

      case 'specific': {
        const qty = this.resolveQuantity(method.per, product);
        return method.amount * eurToDoc * qty;
      }

      case 'combined_min': {
        const adValorem = baseValue * (method.rate / 100);
        const qty = this.resolveQuantity(method.per, product);
        const specific = method.specificAmount * eurToDoc * qty;
        return Math.max(adValorem, specific);
      }

      case 'combined_max': {
        const adValorem = baseValue * (method.rate / 100);
        const qty = this.resolveQuantity(method.per, product);
        const specific = method.specificAmount * eurToDoc * qty;
        return Math.min(adValorem, specific);
      }

      case 'fixed_rate':
        return baseValue * (method.rate / 100);
    }
  }

  private resolveQuantity(per: string, product: InterpretedProduct): number {
    switch (per) {
      case 'kg':
        return product.weight * product.quantity;
      case 'pcs':
      case 'unit':
        return product.quantity;
      default: {
        const dim = product.dimensions?.find((d: Dimension) => d.unit === per);
        if (!dim) {
          this.logger.warn(
            `Missing dimension "${per}" for ${product.tnVedCode}, falling back to weight`,
          );
          return product.weight * product.quantity;
        }
        return dim.value * product.quantity;
      }
    }
  }
}
