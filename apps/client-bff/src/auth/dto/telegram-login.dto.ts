import { IsNumber, IsOptional, IsString, Matches } from 'class-validator';

/**
 * Сырые данные Telegram Login Widget + slug компании (откуда логинится клиент). Набор полей
 * Telegram у виджета фиксирован; whitelist ValidationPipe оставит ровно их — BFF форвардит всё
 * в api на верификацию (TelegramVerifyService воспроизводит data_check_string без slug).
 */
export class TelegramLoginDto {
  /** Компания (URL-slug кабинета), чьим ботом подписан вход. Нет slug → дефолтная компания. */
  @IsOptional()
  @Matches(/^[a-z0-9-]+$/)
  slug?: string;

  @IsNumber()
  id: number;

  @IsOptional()
  @IsString()
  first_name?: string;

  @IsOptional()
  @IsString()
  last_name?: string;

  @IsOptional()
  @IsString()
  username?: string;

  @IsOptional()
  @IsString()
  photo_url?: string;

  @IsNumber()
  auth_date: number;

  @IsString()
  hash: string;
}
