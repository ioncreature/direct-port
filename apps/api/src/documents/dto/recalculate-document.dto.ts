import { Type } from 'class-transformer';
import { IsIn, IsNumber, IsOptional, IsString, Length, Matches, Min } from 'class-validator';
import { FREIGHT_CURRENCIES, type FreightCurrency } from '../../database/entities/document.entity';

export class RecalculateDocumentDto {
  /** OKSMT-код страны происхождения (3 цифры). Если не указан — пересчёт с текущей. */
  @IsOptional()
  @IsString()
  @Length(1, 3)
  @Matches(/^\d{1,3}$/, { message: 'countryOfOrigin must be 1-3 digits' })
  countryOfOrigin?: string;

  /** Стоимость фрахта до границы. Если поле не передано — берётся сохранённое в документе.
   *  Чтобы СБРОСИТЬ фрахт, передайте 0 (валюта при этом игнорируется). */
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0)
  freightCost?: number;

  @IsOptional()
  @IsString()
  @IsIn(FREIGHT_CURRENCIES as readonly string[])
  freightCurrency?: FreightCurrency;
}
