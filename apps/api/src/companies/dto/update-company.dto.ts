import { IsArray, IsIn, IsOptional, IsString, Matches, MinLength } from 'class-validator';
import { COMPANY_THEMES } from '../../common/tenant/company-theme';

export class UpdateCompanyDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  name?: string;

  /** URL-slug кабинета: lowercase/цифры/дефисы; пустая строка — снять slug. См. docs/COMPANY_BOTS.md. */
  @IsOptional()
  @Matches(/^[a-z0-9-]*$/)
  slug?: string;

  /** Тема оформления админки под тенанта. См. common/tenant/company-theme.ts. */
  @IsOptional()
  @IsIn(COMPANY_THEMES)
  theme?: string;

  /** Полный набор доменов тенанта (замещает текущий). Пустой массив — снять все домены. */
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  domains?: string[];
}
