import { IsUUID } from 'class-validator';

/**
 * Self-service загрузка документа из кабинета (Ф3). Файл — в multipart-поле `file`.
 * telegramUserId передаёт BFF из проверенного client-JWT (кто из сотрудников загрузил);
 * api сверяет его принадлежность аккаунту, а не доверяет телу запроса.
 */
export class UploadClientDocumentDto {
  @IsUUID()
  telegramUserId: string;
}
