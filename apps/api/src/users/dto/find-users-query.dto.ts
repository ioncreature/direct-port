import { IsIn, IsOptional } from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { UserRole } from '../../database/entities/user.entity';

export class FindUsersQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsIn(Object.values(UserRole))
  role?: UserRole;

  @IsOptional()
  @IsIn(['createdAt', 'email', 'role'])
  sortBy: string = 'createdAt';
}
