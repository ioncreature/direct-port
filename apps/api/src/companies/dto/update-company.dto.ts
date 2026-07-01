import { IsOptional, IsString, Matches, MinLength } from 'class-validator';

export class UpdateCompanyDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  name?: string;

  /** URL-slug кабинета: lowercase/цифры/дефисы; пустая строка — снять slug. См. docs/COMPANY_BOTS.md. */
  @IsOptional()
  @Matches(/^[a-z0-9-]*$/)
  slug?: string;
}
