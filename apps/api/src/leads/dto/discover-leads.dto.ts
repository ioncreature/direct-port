import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';

export class DiscoverLeadsDto {
  /** Поисковый запрос, напр. «таможенное оформление импорт Владивосток». */
  @IsString()
  @MinLength(3)
  @MaxLength(200)
  query: string;

  /** Город (попадёт в city кандидатов, если AI не определит точнее). */
  @IsOptional()
  @IsString()
  @MaxLength(120)
  city?: string;

  /** Сколько компаний просить найти (1..30, дефолт 10). */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(30)
  maxResults?: number;
}
