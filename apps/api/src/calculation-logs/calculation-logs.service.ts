import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CalculationLog } from '../database/entities/calculation-log.entity';

@Injectable()
export class CalculationLogsService {
  constructor(@InjectRepository(CalculationLog) private repo: Repository<CalculationLog>) {}

  async create(data: Partial<CalculationLog>): Promise<CalculationLog> {
    const log = this.repo.create(data);
    return this.repo.save(log);
  }

  findByDocumentId(documentId: string): Promise<CalculationLog[]> {
    return this.repo.find({
      where: { documentId },
      order: { createdAt: 'DESC' },
    });
  }
}
