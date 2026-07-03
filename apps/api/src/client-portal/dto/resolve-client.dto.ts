import { IsIn, IsNumber, IsOptional, IsString, IsUUID } from 'class-validator';

/**
 * Резолв клиента кабинета по Telegram identity (вызывает client-bff после успешной
 * верификации подписи Telegram Login Widget). Upsert по паре (companyId, telegramId) через
 * TelegramUsersService.register — гарантирует наличие BillingAccount (1:1).
 */
export class ResolveClientDto {
  @IsNumber()
  telegramId: number;

  /**
   * Компания, чьим виджетом залогинился клиент (из verify-telegram). Опционально для
   * обратной совместимости: не передана → дефолтная компания. Клиент уникален парой
   * (company_id, telegram_id). См. docs/COMPANY_BOTS.md.
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
