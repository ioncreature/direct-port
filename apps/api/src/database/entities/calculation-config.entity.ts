import { Column, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

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

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
