import { Controller, Get, Query } from '@nestjs/common';
import { Internal } from '../auth/decorators/internal.decorator';
import { BotsService } from './bots.service';
import { ListBotsQueryDto } from './dto/list-bots-query.dto';

/**
 * Internal-API реестра ботов (auth ТОЛЬКО по X-Internal-Key, @Internal). Потребители —
 * client-bot и manager-bot: при старте и периодическом реконсайле забирают список ботов своей
 * категории с расшифрованными токенами и поднимают по Bot на компанию. См. docs/COMPANY_BOTS.md.
 */
@Controller('internal/bots')
export class BotsController {
  constructor(private bots: BotsService) {}

  @Get()
  @Internal()
  list(@Query() query: ListBotsQueryDto) {
    return this.bots.listBots(query.kind);
  }
}
