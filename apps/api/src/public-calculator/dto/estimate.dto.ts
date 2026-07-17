import { IsIn, IsInt, IsNumber, IsOptional, IsString, Matches, Max, MaxLength, Min, MinLength } from 'class-validator';
import { FREIGHT_CURRENCIES, type FreightCurrency } from '../../database/entities/document.entity';

/**
 * Запрос публичного мини-калькулятора лендинга: один товар без регистрации.
 * price/weight — итоги по партии (не за единицу): для холодного посетителя
 * «стоимость партии» и «общий вес» — естественные величины; сервис сам
 * приводит их к поштучным значениям pipeline-калькулятора через quantity.
 */
export class EstimateDto {
  /** Описание товара или код ТН ВЭД (4–10 цифр — код). */
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  query: string;

  /** Явно выбранный код ТН ВЭД (клик по альтернативе) — минует текстовый поиск. */
  @IsOptional()
  @Matches(/^[\d\s.]{4,13}$/)
  code?: string;

  /** Стоимость партии в валюте `currency`. */
  @IsNumber()
  @Min(0.01)
  @Max(1e12)
  price: number;

  @IsIn(FREIGHT_CURRENCIES as readonly string[])
  currency: FreightCurrency;

  /** Общий вес нетто партии, кг (нужен для специфических ставок EUR/кг). */
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1e9)
  weight?: number;

  /** Количество единиц (нужно для ставок за штуку/пару). */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1e9)
  quantity?: number;

  /** Язык страницы лендинга — для локализуемых замечаний калькулятора. */
  @IsOptional()
  @IsIn(['ru', 'en', 'zh'])
  lang?: 'ru' | 'en' | 'zh';
}
