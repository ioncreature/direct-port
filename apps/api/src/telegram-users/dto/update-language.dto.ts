import { IsIn, IsOptional, IsString, IsUUID } from 'class-validator';

export class UpdateLanguageDto {
  @IsString()
  @IsIn(['ru', 'zh', 'en'])
  language: string;

  /**
   * Компания клиента (из контекста бота). Опционально для обратной совместимости: без неё язык
   * обновляется по голому telegram_id (legacy). Клиент уникален парой (company_id, telegram_id).
   */
  @IsOptional()
  @IsUUID('loose')
  companyId?: string;
}
