import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { LEAD_SOURCES, type LeadSource } from '../../database/entities/lead.entity';

export class ImportLeadItemDto {
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

export class ImportLeadsDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(1000)
  @ValidateNested({ each: true })
  @Type(() => ImportLeadItemDto)
  items: ImportLeadItemDto[];

  /** Источник для всех записей пачки (дефолт fts_registry). */
  @IsOptional()
  @IsIn(LEAD_SOURCES)
  source?: LeadSource;

  /** Ставить ли enrichment-джобы для созданных лидов (дефолт true). */
  @IsOptional()
  @IsBoolean()
  autoEnrich?: boolean;
}
