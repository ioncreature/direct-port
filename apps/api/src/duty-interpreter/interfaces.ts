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

export type ChargeMethod =
  | { kind: 'ad_valorem'; rate: number }
  | { kind: 'specific'; amount: number; unit: string; per: string }
  | { kind: 'combined_min'; rate: number; specificAmount: number; unit: string; per: string }
  | { kind: 'combined_max'; rate: number; specificAmount: number; unit: string; per: string }
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
