import { IsArray, IsObject, IsString, IsUUID } from 'class-validator';

export class CreateDocumentDto {
  @IsUUID()
  telegramUserId: string;

  @IsString()
  originalFileName: string;

  @IsObject()
  columnMapping: Record<string, number>;

  @IsArray()
  parsedData: Record<string, unknown>[];
}
