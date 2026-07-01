import { IsOptional, IsString, Matches, MinLength } from 'class-validator';

export class CreateCompanyDto {
  @IsString()
  @MinLength(1)
  name: string;

  /** URL-slug для личного кабинета (`cabinet/<slug>`): lowercase, цифры, дефисы. См. docs/COMPANY_BOTS.md. */
  @IsOptional()
  @Matches(/^[a-z0-9-]*$/)
  slug?: string;
}
