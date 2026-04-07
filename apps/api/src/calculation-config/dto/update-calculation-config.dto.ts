import { IsNumber, IsOptional, Max, Min } from 'class-validator';

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
}
