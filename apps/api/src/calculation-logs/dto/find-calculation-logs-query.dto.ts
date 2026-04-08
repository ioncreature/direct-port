import { IsIn, IsOptional } from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';

export class FindCalculationLogsQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsIn(['createdAt', 'itemsCount'])
  sortBy: string = 'createdAt';
}
