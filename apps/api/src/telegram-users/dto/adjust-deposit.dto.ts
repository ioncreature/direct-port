import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, MaxLength } from 'class-validator';

export class AdjustDepositDto {
  /** Изменение баланса в позициях: > 0 пополнение, < 0 корректировка. Ноль запрещён. */
  @Type(() => Number)
  @IsInt()
  amount: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  comment?: string;
}
