import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { paginate, PaginatedResponse } from '../common/interfaces/paginated';
import { CalculationLog } from '../database/entities/calculation-log.entity';
import { FindCalculationLogsQueryDto } from './dto/find-calculation-logs-query.dto';

@Injectable()
export class CalculationLogsService {
  constructor(@InjectRepository(CalculationLog) private repo: Repository<CalculationLog>) {}

  async create(data: Partial<CalculationLog>): Promise<CalculationLog> {
    const log = this.repo.create(data);
    return this.repo.save(log);
  }

  async findAll(query: FindCalculationLogsQueryDto): Promise<PaginatedResponse<CalculationLog>> {
    const [data, total] = await this.repo.findAndCount({
      order: { [query.sortBy]: query.sortOrder },
      skip: (query.page - 1) * query.limit,
      take: query.limit,
    });

    return paginate(data, total, query.page, query.limit);
  }
}
