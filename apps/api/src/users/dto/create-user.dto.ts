import { IsEmail, IsEnum, IsOptional, IsString, IsUUID, MinLength } from 'class-validator';
import { UserRole } from '../../database/entities/user.entity';

export class CreateUserDto {
  @IsEmail()
  email: string;

  @IsString()
  @MinLength(6)
  password: string;

  @IsEnum(UserRole)
  role: UserRole;

  /** Компания пользователя. Учитывается только когда создаёт super_admin; admin компании
   *  создаёт пользователей в своей компании, и это поле игнорируется. */
  @IsOptional()
  @IsUUID()
  companyId?: string;
}
