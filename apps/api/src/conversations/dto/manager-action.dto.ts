import { IsInt } from 'class-validator';

/** Тело для действий менеджера над клиентом/документом (claim, start). */
export class ManagerActionDto {
  @IsInt()
  managerTelegramId: number;
}
