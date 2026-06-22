import { IsString, MaxLength, MinLength } from 'class-validator';

export class ReportLeadsDto {
  /** Готовый текст отчёта агента. Кап под лимит Telegram-сообщения (4096). */
  @IsString()
  @MinLength(1)
  @MaxLength(4000)
  text: string;
}
