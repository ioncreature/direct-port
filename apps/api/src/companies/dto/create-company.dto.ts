import { IsArray, IsIn, IsOptional, IsString, Matches, MinLength } from 'class-validator';
import { COMPANY_THEMES } from '../../common/tenant/company-theme';

export class CreateCompanyDto {
  @IsString()
  @MinLength(1)
  name: string;

  /** URL-slug для личного кабинета (`cabinet/<slug>`): lowercase, цифры, дефисы. См. docs/COMPANY_BOTS.md. */
  @IsOptional()
  @Matches(/^[a-z0-9-]*$/)
  slug?: string;

  /** Тема оформления админки под тенанта. См. common/tenant/company-theme.ts. */
  @IsOptional()
  @IsIn(COMPANY_THEMES)
  theme?: string;

  /** Домены тенанта. Нормализуются и проверяются на уникальность в сервисе. */
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  domains?: string[];
}
