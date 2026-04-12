import { IsIn, IsString } from 'class-validator';

export class UpdateLanguageDto {
  @IsString()
  @IsIn(['ru', 'zh', 'en'])
  language: string;
}
