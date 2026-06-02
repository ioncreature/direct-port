import { IsInt, IsString, Length } from 'class-validator';

export class ManagerLinkDto {
  @IsInt()
  telegramId: number;

  @IsString()
  @Length(8, 128)
  token: string;
}
