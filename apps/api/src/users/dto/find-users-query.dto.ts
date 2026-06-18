import { IsIn, IsOptional, IsUUID } from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { UserRole } from '../../database/entities/user.entity';

export class FindUsersQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsIn(Object.values(UserRole))
  role?: UserRole;

  /** Фильтр по компании — учитывается только для super_admin. */
  @IsOptional()
  @IsUUID()
  companyId?: string;

  @IsOptional()
  @IsIn(['createdAt', 'email', 'role'])
  sortBy: string = 'createdAt';
}
