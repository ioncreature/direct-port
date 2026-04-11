import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CalculationConfig } from '../database/entities/calculation-config.entity';

@Injectable()
export class CalculationConfigService {
  private cached: CalculationConfig | null = null;

  constructor(
    @InjectRepository(CalculationConfig)
    private repo: Repository<CalculationConfig>,
  ) {}

  async get(): Promise<CalculationConfig> {
    if (this.cached) return this.cached;

    const config = await this.repo.findOne({ where: { id: 1 } });
    if (config) {
      this.cached = config;
      return config;
    }

    const created = await this.repo.save(
      this.repo.create({ pricePercent: 5, weightRate: 0, fixedFee: 0 }),
    );
    this.cached = created;
    return created;
  }

  async update(dto: {
    pricePercent?: number;
    weightRate?: number;
    fixedFee?: number;
  }): Promise<CalculationConfig> {
    const config = await this.get();
    if (dto.pricePercent !== undefined) config.pricePercent = dto.pricePercent;
    if (dto.weightRate !== undefined) config.weightRate = dto.weightRate;
    if (dto.fixedFee !== undefined) config.fixedFee = dto.fixedFee;
    const saved = await this.repo.save(config);
    this.cached = saved;
    return saved;
  }
}
