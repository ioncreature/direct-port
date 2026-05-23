import { Type } from 'class-transformer';
import { IsIn, IsNumber, IsOptional, IsString, Min } from 'class-validator';
import { FREIGHT_CURRENCIES, type FreightCurrency } from '../../database/entities/document.entity';

/** Body для POST /documents/upload-admin (multipart, transform:true). */
export class UploadAdminDto {
  /** Общая стоимость фрахта до границы. Распределяется на позиции пропорционально весу нетто. */
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
