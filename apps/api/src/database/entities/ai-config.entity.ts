import { Column, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

/**
 * Допустимые уровни моделей Claude. Маппинг на model ID — в AiConfigService.
 */
export type AiModelTier = 'opus' | 'sonnet' | 'haiku';

@Entity('ai_config')
export class AiConfig {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'varchar', length: 10, name: 'parser_model', default: 'sonnet' })
  parserModel: AiModelTier;

  @Column({ type: 'varchar', length: 10, name: 'classifier_model', default: 'sonnet' })
  classifierModel: AiModelTier;

  @Column({ type: 'varchar', length: 10, name: 'interpreter_model', default: 'sonnet' })
  interpreterModel: AiModelTier;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
