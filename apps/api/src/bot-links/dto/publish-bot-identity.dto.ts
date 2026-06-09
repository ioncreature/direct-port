import { IsIn, IsString } from 'class-validator';

export type BotKind = 'client' | 'manager';

export const BOT_KINDS: BotKind[] = ['client', 'manager'];

/** Идентичность бота, публикуемая client-bot/manager-bot при старте (getMe). */
export class PublishBotIdentityDto {
  @IsIn(BOT_KINDS)
  kind: BotKind;

  @IsString()
  username: string;
}
