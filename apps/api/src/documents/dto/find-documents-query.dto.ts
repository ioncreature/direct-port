import { IsIn, IsOptional } from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { DocumentStatus } from '../../database/entities/document.entity';

export class FindDocumentsQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsIn(Object.values(DocumentStatus))
  status?: DocumentStatus;

  @IsOptional()
  @IsIn(['createdAt', 'originalFileName', 'status', 'rowCount'])
  sortBy: string = 'createdAt';
}
