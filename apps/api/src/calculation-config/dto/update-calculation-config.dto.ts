import { IsBoolean, IsIn, IsNumber, IsOptional, Max, Min } from 'class-validator';
import type { LowConfidenceAction } from '../../database/entities/calculation-config.entity';

export class UpdateCalculationConfigDto {
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  pricePercent?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  weightRate?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  fixedFee?: number;

  @IsOptional()
  @IsBoolean()
  sendResultFile?: boolean;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1)
  confidenceThreshold?: number;

  @IsOptional()
  @IsIn(['review', 'reject'])
  lowConfidenceAction?: LowConfidenceAction;
}
