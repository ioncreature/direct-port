import { Type } from 'class-transformer';
import { IsIn, IsNumber, IsOptional, IsString, Max, Min } from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { LEAD_SOURCES, LeadStatus, type LeadSource } from '../../database/entities/lead.entity';

export class FindLeadsQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsIn(Object.values(LeadStatus))
  status?: LeadStatus;

  @IsOptional()
  @IsIn(LEAD_SOURCES)
  source?: LeadSource;

  /** Нижняя граница relevanceScore (включительно). */
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(1)
  minScore?: number;

  /** Подстрока по названию компании / городу / домену. */
  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsIn(['createdAt', 'companyName', 'relevanceScore', 'status', 'city'])
  sortBy: string = 'createdAt';
}
