import { IsString } from 'class-validator';

/** Тело создания заявки на пополнение из кабинета. Автора (telegramUserId) BFF берёт из JWT. */
export class CreateTopUpDto {
  @IsString()
  packageKey: string;
}
