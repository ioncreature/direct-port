import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Internal } from '../auth/decorators/internal.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { Actor, resolveCompanyScope } from '../common/tenant/actor-context';
import { UserRole } from '../database/entities/user.entity';
import { BotLinksService } from './bot-links.service';
import { BotLinksQueryDto } from './dto/bot-links-query.dto';
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

  /**
   * Боты для админки. Собственный бот компании (own:true), иначе общий платформенный (own:false).
   * Компания резолвится из JWT: admin/customs — своя; super_admin — по `?companyId=` (или общие).
   */
  @Get()
  @Roles(UserRole.ADMIN, UserRole.CUSTOMS)
  getLinks(@CurrentUser() actor: Actor, @Query() query: BotLinksQueryDto) {
    return this.botLinks.getLinksForCompany(resolveCompanyScope(actor, query.companyId));
  }
}
