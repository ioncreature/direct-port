import { IsString, MaxLength, MinLength } from 'class-validator';

export class ClarifyRowDto {
  @IsString()
  @MinLength(2, { message: 'userNote must be at least 2 characters' })
  @MaxLength(500, { message: 'userNote must not exceed 500 characters' })
  userNote: string;
}
