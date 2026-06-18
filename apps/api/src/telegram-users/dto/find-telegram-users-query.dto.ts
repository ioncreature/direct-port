import { IsIn, IsOptional, IsUUID } from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';

export class FindTelegramUsersQueryDto extends PaginationQueryDto {
  /** Фильтр по компании — учитывается только для super_admin. */
  @IsOptional()
  @IsUUID()
  companyId?: string;

  @IsOptional()
  @IsIn(['createdAt', 'username'])
  sortBy: string = 'createdAt';
}
