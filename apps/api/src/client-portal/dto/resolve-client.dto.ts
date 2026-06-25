import { IsIn, IsNumber, IsOptional, IsString } from 'class-validator';

/**
 * Резолв клиента кабинета по Telegram identity (вызывает client-bff после успешной
 * верификации подписи Telegram Login Widget). Upsert по telegramId через
 * TelegramUsersService.register — гарантирует наличие BillingAccount (1:1).
 */
export class ResolveClientDto {
  @IsNumber()
  telegramId: number;

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
