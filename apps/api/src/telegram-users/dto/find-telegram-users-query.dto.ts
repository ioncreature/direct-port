import { IsIn, IsOptional } from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';

export class FindTelegramUsersQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsIn(['createdAt', 'username'])
  sortBy: string = 'createdAt';
}
