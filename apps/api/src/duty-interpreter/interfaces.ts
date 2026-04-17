import type { VerifiedProduct } from '../classifier/classifier.service';

export type ChargeType =
  | 'import_duty'
  | 'excise'
  | 'vat'
  | 'antidumping'
  | 'compensatory'
  | 'temp_duty';
export type BaseType =
  | 'customs_value'
  | 'customs_value_plus_duty'
  | 'customs_value_plus_duty_plus_excise';

/** Одна specific-составляющая: сумма в `unit` за единицу `per`. */
export interface SpecificPart {
  amount: number;
  unit: string;
  per: string;
}

export type ChargeMethod =
  | { kind: 'ad_valorem'; rate: number }
  | { kind: 'specific'; amount: number; unit: string; per: string }
  | { kind: 'combined_min'; rate: number; specificAmount: number; unit: string; per: string }
  | { kind: 'combined_max'; rate: number; specificAmount: number; unit: string; per: string }
  /** Две specific-составляющие в разных единицах: "0,5 EUR/пар но не менее 2 EUR/кг" = max. */
  | { kind: 'combined_specific_min'; primary: SpecificPart; fallback: SpecificPart }
  /** Две specific-составляющие: "0,5 EUR/пар но не более 2 EUR/кг" = min. */
  | { kind: 'combined_specific_max'; primary: SpecificPart; fallback: SpecificPart }
  | { kind: 'fixed_rate'; rate: number };

export interface DutyChargeRule {
  type: ChargeType;
  label: string;
  method: ChargeMethod;
  base: BaseType;
  currency?: string;
}

export interface DutyInterpretation {
  tnvedCode: string;
  charges: DutyChargeRule[];
  requiredDimensions?: string[];
  reasoning: string;
  reasoningLocalized?: string;
}

export interface InterpretedProduct extends VerifiedProduct {
  dutyInterpretation: DutyInterpretation | null;
}

export interface Dimension {
  name: string;
  value: number;
  unit: string;
}
