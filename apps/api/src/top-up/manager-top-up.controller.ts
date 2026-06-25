import { Body, Controller, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { Internal } from '../auth/decorators/internal.decorator';
import { ManagerActionDto } from '../conversations/dto/manager-action.dto';
import { TopUpService } from './top-up.service';

/**
 * Подтверждение/отклонение заявок на пополнение менеджером (manager-bot, auth ТОЛЬКО
 * по X-Internal-Key). Менеджер резолвится по managerTelegramId. Подтверждение
 * идемпотентно — повторный клик/гонка двух менеджеров не задваивают зачисление.
 */
@Controller('manager/topups')
export class ManagerTopUpController {
  constructor(private topUp: TopUpService) {}

  @Post(':id/confirm')
  @Internal()
  confirm(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ManagerActionDto) {
    return this.topUp.confirmByManager(id, String(dto.managerTelegramId));
  }

  @Post(':id/cancel')
  @Internal()
  cancel(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ManagerActionDto) {
    return this.topUp.cancelByManager(id, String(dto.managerTelegramId));
  }
}
