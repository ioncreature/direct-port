import { IsOptional, IsString, IsUUID } from 'class-validator';

export class IntakeUploadDto {
  @IsUUID()
  telegramUserId: string;

  /** Telegram file_id исходного файла — для ссылки в переписке (опционально). */
  @IsOptional()
  @IsString()
  fileId?: string;

  /** Подпись к файлу (caption) — сопроводительный текст клиента. */
  @IsOptional()
  @IsString()
  text?: string;
}
