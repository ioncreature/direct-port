import { IsInt, IsNotEmpty, IsString, IsUUID, MaxLength } from 'class-validator';

export class ManagerMessageDto {
  @IsInt()
  managerTelegramId: number;

  @IsUUID()
  clientId: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(4096)
  text: string;
}
