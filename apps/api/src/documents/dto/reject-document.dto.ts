import { IsString, MinLength } from 'class-validator';

export class RejectDocumentDto {
  @IsString()
  @MinLength(1)
  reason: string;
}
