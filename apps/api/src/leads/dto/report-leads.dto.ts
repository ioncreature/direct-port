import { IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';

export class ReportLeadsDto {
  /** Готовый текст отчёта агента. Кап под лимит Telegram-сообщения (4096). */
  @IsString()
  @MinLength(1)
  @MaxLength(4000)
  text: string;

  /** Компания, чьим менеджерам доставить отчёт. Не передана → дефолтная. */
  @IsOptional()
  @IsUUID('loose')
  companyId?: string;
}
