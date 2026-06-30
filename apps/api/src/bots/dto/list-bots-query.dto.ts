import { IsIn } from 'class-validator';
import type { BotKind } from '../bots.service';

export class ListBotsQueryDto {
  @IsIn(['client', 'manager'])
  kind: BotKind;
}
