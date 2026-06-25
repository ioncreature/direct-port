import { IsString, IsUUID } from 'class-validator';

/**
 * Создание заявки на пополнение из кабинета. telegramUserId передаёт BFF из проверенного
 * client-JWT (кто из сотрудников оформил); api сверяет его принадлежность аккаунту.
 * Цена не приходит от клиента — фиксируется сервером из пакета.
 */
export class CreateTopUpDto {
  @IsString()
  packageKey: string;

  @IsUUID()
  telegramUserId: string;
}
