import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

@Entity('tn_ved_codes')
export class TnVedCode {
  @PrimaryGeneratedColumn()
  id: number;

  @Index()
  @Column({ type: 'varchar', length: 20, unique: true })
  code: string;

  @Column({ type: 'text' })
  description: string;

  @Column({ type: 'varchar', length: 50, nullable: true })
  unit: string | null;

  @Column({ type: 'decimal', precision: 5, scale: 2, name: 'duty_rate', default: 0 })
  dutyRate: number;

  @Column({ type: 'decimal', precision: 5, scale: 2, name: 'vat_rate', default: 20 })
  vatRate: number;

  @Column({ type: 'decimal', precision: 10, scale: 2, name: 'excise_rate', default: 0 })
  exciseRate: number;

  @Column({ type: 'varchar', length: 20, name: 'parent_code', nullable: true })
  parentCode: string | null;

  @Column({ type: 'smallint' })
  level: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
