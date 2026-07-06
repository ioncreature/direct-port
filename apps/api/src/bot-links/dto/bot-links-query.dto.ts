import { IsOptional, IsUUID } from 'class-validator';

/** Query для GET /bot-links. companyId учитывается только для super_admin (см. resolveCompanyScope). */
export class BotLinksQueryDto {
  @IsOptional()
  @IsUUID('loose')
  companyId?: string;
}
