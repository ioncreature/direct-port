import { IsIn, IsNumber, IsOptional, IsString } from 'class-validator';

export class RegisterTelegramUserDto {
  @IsNumber()
  telegramId: number;

  @IsOptional()
  @IsString()
  username?: string;

  @IsOptional()
  @IsString()
  firstName?: string;

  @IsOptional()
  @IsString()
  lastName?: string;

  @IsOptional()
  @IsString()
  @IsIn(['ru', 'zh', 'en'])
  language?: string;
}
