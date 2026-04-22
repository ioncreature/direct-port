import { IsOptional, IsString, Length, Matches } from 'class-validator';

export class RecalculateDocumentDto {
  /** OKSMT-код страны происхождения (3 цифры). Если не указан — пересчёт с текущей. */
  @IsOptional()
  @IsString()
  @Length(1, 3)
  @Matches(/^\d{1,3}$/, { message: 'countryOfOrigin must be 1-3 digits' })
  countryOfOrigin?: string;
}
