import { IsNumber, IsOptional, IsString, Matches } from 'class-validator';

/**
 * Данные Telegram Login Widget + slug компании для верификации подписи в api
 * (вызывает client-bff). Поля Telegram повторяют виджет — whitelist ValidationPipe оставит
 * ровно их, что нужно для воспроизведения data_check_string. `slug` — наша добавка (компания,
 * чьим ботом подписан вход); в data_check_string он НЕ входит. См. docs/COMPANY_BOTS.md (Фаза 4).
 */
export class VerifyTelegramDto {
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
