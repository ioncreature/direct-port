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

  @Column({ type: 'varchar', length: 10, name: 'query_formulation_model', default: 'haiku' })
  queryFormulationModel: AiModelTier;

  @Column({ type: 'varchar', length: 10, name: 'classifier_model', default: 'sonnet' })
  classifierModel: AiModelTier;

  @Column({ type: 'varchar', length: 10, name: 'interpreter_model', default: 'sonnet' })
  interpreterModel: AiModelTier;

  /**
   * Модель для второго прохода classifier с фотографиями товара (vision-retry
   * для строк с matchConfidence ниже confidenceThreshold). Все доступные тиры
   * Claude (opus/sonnet/haiku) поддерживают vision.
   */
  @Column({ type: 'varchar', length: 10, name: 'photo_classifier_model', default: 'sonnet' })
  photoClassifierModel: AiModelTier;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
