import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CalculationConfig, type LowConfidenceAction } from '../database/entities/calculation-config.entity';

const CACHE_TTL = 60_000;

@Injectable()
export class CalculationConfigService {
  private cached: CalculationConfig | null = null;
  private cachedAt = 0;

  constructor(
    @InjectRepository(CalculationConfig)
    private repo: Repository<CalculationConfig>,
  ) {}

  async get(): Promise<CalculationConfig> {
    if (this.cached && Date.now() - this.cachedAt < CACHE_TTL) return this.cached;

    const config = await this.repo.findOne({ where: { id: 1 } });
    if (config) {
      this.cached = config;
      this.cachedAt = Date.now();
      return config;
    }

    const created = await this.repo.save(
      this.repo.create({
        confidenceThreshold: 0.8,
        lowConfidenceAction: 'review',
      }),
    );
    this.cached = created;
    this.cachedAt = Date.now();
    return created;
  }

  async update(dto: {
    confidenceThreshold?: number;
    lowConfidenceAction?: LowConfidenceAction;
  }): Promise<CalculationConfig> {
    const config = await this.get();
    if (dto.confidenceThreshold !== undefined)
      config.confidenceThreshold = dto.confidenceThreshold;
    if (dto.lowConfidenceAction !== undefined)
      config.lowConfidenceAction = dto.lowConfidenceAction;
    const saved = await this.repo.save(config);
    this.cached = saved;
    this.cachedAt = Date.now();
    return saved;
  }
}
