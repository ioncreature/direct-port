import { IsString, MinLength } from 'class-validator';

export class SetBotTokenDto {
  /** Токен Telegram-бота от @BotFather. Валидируется через getMe перед сохранением. */
  @IsString()
  @MinLength(20)
  token: string;
}
