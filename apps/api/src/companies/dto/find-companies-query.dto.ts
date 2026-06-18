import { IsIn, IsOptional } from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';

export class FindCompaniesQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsIn(['createdAt', 'name'])
  sortBy: string = 'createdAt';
}
