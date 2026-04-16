import { Column, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

export type LowConfidenceAction = 'review' | 'reject';

const decimalTransformer = {
  to: (value: number) => value,
  from: (value: string | null) => (value === null ? null : parseFloat(value)),
};

@Entity('calculation_config')
export class CalculationConfig {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({
    type: 'decimal',
    precision: 8,
    scale: 4,
    name: 'price_percent',
    default: 5,
    transformer: decimalTransformer,
  })
  pricePercent: number;

  @Column({
    type: 'decimal',
    precision: 10,
    scale: 4,
    name: 'weight_rate',
    default: 0,
    transformer: decimalTransformer,
  })
  weightRate: number;

  @Column({
    type: 'decimal',
    precision: 10,
    scale: 2,
    name: 'fixed_fee',
    default: 0,
    transformer: decimalTransformer,
  })
  fixedFee: number;

  @Column({ name: 'send_result_file', type: 'boolean', default: true })
  sendResultFile: boolean;

  @Column({
    type: 'decimal',
    precision: 3,
    scale: 2,
    name: 'confidence_threshold',
    default: 0.8,
    transformer: decimalTransformer,
  })
  confidenceThreshold: number;

  @Column({
    type: 'varchar',
    length: 16,
    name: 'low_confidence_action',
    default: 'review',
  })
  lowConfidenceAction: LowConfidenceAction;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
