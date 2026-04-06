import { Injectable } from '@nestjs/common';
import { ClassifiedProduct } from '../classifier/classifier.service';

export interface CalculatedProduct extends ClassifiedProduct {
  dutyAmount: number;
  vatAmount: number;
  exciseAmount: number;
  logisticsCommission: number;
  totalCost: number;
}

export interface CalculationSummary {
  items: CalculatedProduct[];
  totalDuty: number;
  totalVat: number;
  totalExcise: number;
  totalLogistics: number;
  grandTotal: number;
}

@Injectable()
export class CalculatorService {
  calculate(products: ClassifiedProduct[]): CalculationSummary {
    const items = products.map((p) => {
      const totalPrice = p.price * p.quantity;
      const dutyAmount = totalPrice * (p.dutyRate / 100);
      const exciseAmount = totalPrice * (p.exciseRate / 100);
      const vatAmount = (totalPrice + dutyAmount + exciseAmount) * (p.vatRate / 100);
      // TODO: уточнить формулу логистической комиссии
      const logisticsCommission = totalPrice * 0.05;
      const totalCost = totalPrice + dutyAmount + vatAmount + exciseAmount + logisticsCommission;

      return { ...p, dutyAmount, vatAmount, exciseAmount, logisticsCommission, totalCost };
    });

    return {
      items,
      totalDuty: items.reduce((s, i) => s + i.dutyAmount, 0),
      totalVat: items.reduce((s, i) => s + i.vatAmount, 0),
      totalExcise: items.reduce((s, i) => s + i.exciseAmount, 0),
      totalLogistics: items.reduce((s, i) => s + i.logisticsCommission, 0),
      grandTotal: items.reduce((s, i) => s + i.totalCost, 0),
    };
  }
}
