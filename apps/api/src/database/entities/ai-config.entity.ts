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

  /**
   * Модель для AI-выжимок разрешительных мер (RegulatoryInterpreterService).
   * Задача — короткий пересказ NOTE-текста (форма документа, регулятор, нюансы),
   * не reasoning. Haiku по умолчанию: дешёвый, быстрый, кэшируется в БД на 180д.
   */
  @Column({ type: 'varchar', length: 10, name: 'regulatory_interpreter_model', default: 'haiku' })
  regulatoryInterpreterModel: AiModelTier;

  /**
   * Модель для discovery лидов (web-поиск компаний-импортёров через server-side
   * web_search). Sonnet по умолчанию: поиск + отбор кандидатов выигрывает от модели
   * посильнее haiku, но не требует Opus.
   */
  @Column({ type: 'varchar', length: 10, name: 'lead_discovery_model', default: 'sonnet' })
  leadDiscoveryModel: AiModelTier;

  /**
   * Модель для обогащения лида (извлечение контактов с сайта + скоринг релевантности).
   * Haiku по умолчанию: извлечение и классификация, не reasoning — дёшево и быстро.
   */
  @Column({ type: 'varchar', length: 10, name: 'lead_enrichment_model', default: 'haiku' })
  leadEnrichmentModel: AiModelTier;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
