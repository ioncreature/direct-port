import { IsUUID } from 'class-validator';

export class LinkClientDto {
  /** Клиент (telegram-пользователь), в которого сконвертировался лид. */
  @IsUUID()
  telegramUserId: string;
}
