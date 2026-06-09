import { Body, Controller, Get, Post } from '@nestjs/common';
import { Internal } from '../auth/decorators/internal.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { UserRole } from '../database/entities/user.entity';
import { BotLinksService } from './bot-links.service';
import { PublishBotIdentityDto } from './dto/publish-bot-identity.dto';

@Controller('bot-links')
export class BotLinksController {
  constructor(private readonly botLinks: BotLinksService) {}

  /** Публикация username бота (от client-bot/manager-bot при старте). X-Internal-Key. */
  @Post('identity')
  @Internal()
  async publish(@Body() dto: PublishBotIdentityDto) {
    await this.botLinks.setIdentity(dto.kind, dto.username);
    return { ok: true };
  }

  /** Ссылки на ботов для админки. */
  @Get()
  @Roles(UserRole.ADMIN, UserRole.CUSTOMS)
  getLinks() {
    return this.botLinks.getLinks();
  }
}
