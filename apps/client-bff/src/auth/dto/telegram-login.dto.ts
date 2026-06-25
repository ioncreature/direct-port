import { IsNumber, IsOptional, IsString } from 'class-validator';

/**
 * Сырые данные Telegram Login Widget. Набор полей у виджета фиксирован; whitelist
 * ValidationPipe оставит ровно их, что и нужно для воспроизведения data_check_string
 * при верификации подписи (TelegramAuthService).
 */
export class TelegramLoginDto {
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
