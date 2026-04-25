import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AiConfig, type AiModelTier } from '../database/entities/ai-config.entity';

const MODEL_IDS: Record<AiModelTier, string> = {
  opus: 'claude-opus-4-7',
  sonnet: 'claude-sonnet-4-6',
  haiku: 'claude-haiku-4-5-20251001',
};

const CACHE_TTL = 60_000; // 1 минута

@Injectable()
export class AiConfigService {
  private logger = new Logger(AiConfigService.name);
  private cached: AiConfig | null = null;
  private cachedAt = 0;

  constructor(
    @InjectRepository(AiConfig) private repo: Repository<AiConfig>,
  ) {}

  async get(): Promise<AiConfig> {
    if (this.cached && Date.now() - this.cachedAt < CACHE_TTL) {
      return this.cached;
    }

    const config = await this.repo.findOne({ where: { id: 1 } });
    if (config) {
      this.cached = config;
      this.cachedAt = Date.now();
      return config;
    }

    const created = await this.repo.save(
      this.repo.create({
        parserModel: 'sonnet',
        queryFormulationModel: 'haiku',
        classifierModel: 'sonnet',
        interpreterModel: 'sonnet',
        photoClassifierModel: 'sonnet',
      }),
    );
    this.cached = created;
    this.cachedAt = Date.now();
    return created;
  }

  async update(dto: {
    parserModel?: AiModelTier;
    queryFormulationModel?: AiModelTier;
    classifierModel?: AiModelTier;
    interpreterModel?: AiModelTier;
    photoClassifierModel?: AiModelTier;
  }): Promise<AiConfig> {
    const config = await this.get();
    if (dto.parserModel !== undefined) config.parserModel = dto.parserModel;
    if (dto.queryFormulationModel !== undefined) config.queryFormulationModel = dto.queryFormulationModel;
    if (dto.classifierModel !== undefined) config.classifierModel = dto.classifierModel;
    if (dto.interpreterModel !== undefined) config.interpreterModel = dto.interpreterModel;
    if (dto.photoClassifierModel !== undefined) config.photoClassifierModel = dto.photoClassifierModel;
    const saved = await this.repo.save(config);
    this.cached = saved;
    this.cachedAt = Date.now();
    this.logger.log(
      `AI config updated: parser=${saved.parserModel}, queryFormulation=${saved.queryFormulationModel}, ` +
        `classifier=${saved.classifierModel}, interpreter=${saved.interpreterModel}, ` +
        `photoClassifier=${saved.photoClassifierModel}`,
    );
    return saved;
  }

  /** Возвращает model ID для парсера (например 'claude-sonnet-4-6'). */
  async getParserModel(): Promise<string> {
    const config = await this.get();
    return MODEL_IDS[config.parserModel] ?? MODEL_IDS.sonnet;
  }

  /** Возвращает model ID для формулировки поисковых запросов в TKS. */
  async getQueryFormulationModel(): Promise<string> {
    const config = await this.get();
    return MODEL_IDS[config.queryFormulationModel] ?? MODEL_IDS.haiku;
  }

  /** Возвращает model ID для классификатора. */
  async getClassifierModel(): Promise<string> {
    const config = await this.get();
    return MODEL_IDS[config.classifierModel] ?? MODEL_IDS.sonnet;
  }

  /** Возвращает model ID для интерпретатора пошлин. */
  async getInterpreterModel(): Promise<string> {
    const config = await this.get();
    return MODEL_IDS[config.interpreterModel] ?? MODEL_IDS.sonnet;
  }

  /** Возвращает model ID для второго прохода classifier с фото. */
  async getPhotoClassifierModel(): Promise<string> {
    const config = await this.get();
    return MODEL_IDS[config.photoClassifierModel] ?? MODEL_IDS.sonnet;
  }
}
