import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class CreateLeadDto {
  @IsString()
  @MinLength(2)
  @MaxLength(500)
  companyName: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  website?: string;

  @IsOptional()
  @IsString()
  @MaxLength(12)
  inn?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  city?: string;
}
