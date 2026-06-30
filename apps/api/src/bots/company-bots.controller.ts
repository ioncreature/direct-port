import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseEnumPipe,
  ParseUUIDPipe,
  Put,
} from '@nestjs/common';
import { Roles } from '../auth/decorators/roles.decorator';
import { BOT_KINDS, type BotKind } from '../bot-links/dto/publish-bot-identity.dto';
import { UserRole } from '../database/entities/user.entity';
import { BotsService } from './bots.service';
import { SetBotTokenDto } from './dto/set-bot-token.dto';

/**
 * Self-service управление ботами компании (только super_admin): статус ботов, установка и снятие
 * токена клиентского/менеджерского бота. Токен валидируется через getMe, шифруется и сохраняется
 * в companies; изменение публикуется в Redis для динамического подъёма бота. См. docs/COMPANY_BOTS.md.
 */
@Controller('companies/:companyId/bots')
@Roles(UserRole.SUPER_ADMIN)
export class CompanyBotsController {
  constructor(private bots: BotsService) {}

  @Get()
  status(@Param('companyId', ParseUUIDPipe) companyId: string) {
    return this.bots.getCompanyBots(companyId);
  }

  @Put(':kind')
  set(
    @Param('companyId', ParseUUIDPipe) companyId: string,
    @Param('kind', new ParseEnumPipe(BOT_KINDS)) kind: BotKind,
    @Body() dto: SetBotTokenDto,
  ) {
    return this.bots.setBotToken(companyId, kind, dto.token);
  }

  @Delete(':kind')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(
    @Param('companyId', ParseUUIDPipe) companyId: string,
    @Param('kind', new ParseEnumPipe(BOT_KINDS)) kind: BotKind,
  ) {
    return this.bots.removeBotToken(companyId, kind);
  }
}
