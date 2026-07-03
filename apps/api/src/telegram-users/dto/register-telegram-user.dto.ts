import { IsIn, IsNumber, IsOptional, IsString, IsUUID } from 'class-validator';

export class RegisterTelegramUserDto {
  @IsNumber()
  telegramId: number;

  /**
   * Компания бота, в который написал клиент (из контекста бота). Опционально для обратной
   * совместимости: если не передана (дефолтный env-бот / legacy-вызов) — дефолтная компания.
   * Клиент уникален парой (company_id, telegram_id). См. docs/COMPANY_BOTS.md.
   */
  @IsOptional()
  @IsUUID('loose')
  companyId?: string;

  @IsOptional()
  @IsString()
  username?: string;

  @IsOptional()
  @IsString()
  firstName?: string;

  @IsOptional()
  @IsString()
  lastName?: string;

  @IsOptional()
  @IsString()
  @IsIn(['ru', 'zh', 'en'])
  language?: string;
}
