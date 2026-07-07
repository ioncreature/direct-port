import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  Min,
  ValidateNested,
} from 'class-validator';

/**
 * Строка parsedData при ручном ревью. Набор полей обязан покрывать ParsedProduct
 * (ai-parser.service.ts): глобальный ValidationPipe({ whitelist: true }) вырезает
 * из вложенных объектов всё без декоратора, а updateParsedData заменяет массив
 * целиком — поле, забытое здесь, молча теряется при каждом сохранении ревью
 * (weightGross → фрахт распределялся бы по нетто, countryOfOrigin → неверные
 * страновые ставки). При добавлении поля в ParsedProduct — добавь его и сюда.
 *
 * Редактируемые поля — строгая валидация; passthrough-поля (dimensions, attributes,
 * rawContext…) — лёгкая: пайплайн всё равно нормализует их на входе processing
 * (extractDimensions, normalizeProductAttributes, normalizeOksmtCode).
 */
export class ParsedDataRowDto {
  @IsString()
  description: string;

  /** Оригинальное (до перевода) наименование — для диагностики и retry-промптов. */
  @IsOptional()
  @IsString()
  descriptionOriginal?: string;

  @IsNumber()
  @Min(0)
  quantity: number;

  @IsNumber()
  @Min(0)
  price: number;

  @IsNumber()
  @Min(0)
  weight: number;

  /** Вес БРУТТО за единицу, кг — базис распределения фрахта, когда есть. */
  @IsOptional()
  @IsNumber()
  @Min(0)
  weightGross?: number;

  @IsOptional()
  @IsArray()
  dimensions?: unknown[];

  @IsOptional()
  @IsString()
  hsCode?: string;

  /** OKSMT-код страны происхождения строки (перекрывает страну документа). */
  @IsOptional()
  @Matches(/^\d{1,3}$/, { message: 'countryOfOrigin must be 1-3 digits' })
  countryOfOrigin?: string;

  @IsOptional()
  @IsString()
  rawContext?: string;

  /** Структурированные атрибуты (материал, бренд…) — нормализует normalizeProductAttributes. */
  @IsOptional()
  @IsObject()
  attributes?: Record<string, unknown>;
}

export class ReviewDocumentDto {
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => ParsedDataRowDto)
  parsedData: ParsedDataRowDto[];

  @IsOptional()
  @IsString()
  currency?: string;
}
