import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import { Response } from 'express';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Internal } from '../auth/decorators/internal.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { Actor, DEFAULT_COMPANY_ID, resolveCompanyScope } from '../common/tenant/actor-context';
import { UserRole } from '../database/entities/user.entity';
import { CreateLeadDto } from './dto/create-lead.dto';
import { DiscoverLeadsDto } from './dto/discover-leads.dto';
import { FindLeadsQueryDto } from './dto/find-leads-query.dto';
import { ImportLeadsDto } from './dto/import-leads.dto';
import { LinkClientDto } from './dto/link-client.dto';
import { ReportLeadsDto } from './dto/report-leads.dto';
import { UpdateLeadDto } from './dto/update-lead.dto';
import { LeadsService } from './leads.service';

// Лиды — глобальный инструмент роста, доступен только super_admin. admin/customs
// получают 403 (как и раздел «Компании»). @Internal-маршруты агента (по X-Internal-Key)
// роль не проверяют, поэтому @Roles навешан по-методно, а не на весь контроллер:
// контроллер-левел @Roles ломал бы их (RolesGuard без user → false).
@Controller('leads')
export class LeadsController {
  constructor(private service: LeadsService) {}

  @Get()
  @Roles(UserRole.SUPER_ADMIN)
  findAll(@Query() query: FindLeadsQueryDto, @CurrentUser() actor: Actor) {
    return this.service.findAll(query, actor);
  }

  @Get('status-counts')
  @Roles(UserRole.SUPER_ADMIN)
  statusCounts(@CurrentUser() actor: Actor) {
    return this.service.getStatusCounts(actor);
  }

  @Get('searches')
  @Roles(UserRole.SUPER_ADMIN)
  searchHistory(@Query('limit') limit?: string) {
    return this.service.getSearchHistory(Math.min(Number(limit) || 20, 50));
  }

  // --- Контур автономного агента (routine), доступ по X-Internal-Key ---

  /** История поисков — агент решает, что искать дальше, не повторяясь. */
  @Get('agent/searches')
  @Internal()
  agentSearches(@Query('limit') limit?: string) {
    return this.service.getSearchHistory(Math.min(Number(limit) || 30, 100));
  }

  /** Запуск web-поиска агентом. */
  @Post('agent/discover')
  @Internal()
  agentDiscover(@Body() dto: DiscoverLeadsDto) {
    return this.service.discover(dto, DEFAULT_COMPANY_ID);
  }

  /** Дайджест свежих горячих лидов за период (часы); порог score настраивается агентом. */
  @Get('agent/digest')
  @Internal()
  agentDigest(@Query('hours') hours?: string, @Query('minScore') minScore?: string) {
    const parsedScore = Number(minScore);
    return this.service.getDigest(
      Math.min(Number(hours) || 24, 168),
      Number.isFinite(parsedScore) ? Math.min(Math.max(parsedScore, 0), 1) : undefined,
      DEFAULT_COMPANY_ID,
    );
  }

  /** Доставить готовый отчёт менеджерам в Telegram. */
  @Post('agent/report')
  @Internal()
  agentReport(@Body() dto: ReportLeadsDto) {
    return this.service.reportToManagers(dto.text);
  }

  @Get('export')
  @Roles(UserRole.SUPER_ADMIN)
  async export(@Query() query: FindLeadsQueryDto, @Res() res: Response, @CurrentUser() actor: Actor) {
    const csv = await this.service.exportCsv(query, actor);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="leads.csv"');
    res.send(csv);
  }

  @Post()
  @Roles(UserRole.SUPER_ADMIN)
  create(@Body() dto: CreateLeadDto, @CurrentUser() actor: Actor) {
    return this.service.create(dto, actor);
  }

  @Post('discover')
  @Roles(UserRole.SUPER_ADMIN)
  discover(@Body() dto: DiscoverLeadsDto, @CurrentUser() actor: Actor) {
    return this.service.discover(dto, resolveCompanyScope(actor) ?? null);
  }

  @Post('import')
  @Roles(UserRole.SUPER_ADMIN)
  import(@Body() dto: ImportLeadsDto, @CurrentUser() actor: Actor) {
    return this.service.import(dto, actor);
  }

  @Get(':id')
  @Roles(UserRole.SUPER_ADMIN)
  findOne(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() actor: Actor) {
    return this.service.findOne(id, actor);
  }

  @Patch(':id')
  @Roles(UserRole.SUPER_ADMIN)
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateLeadDto,
    @CurrentUser() actor: Actor,
  ) {
    return this.service.update(id, dto, actor);
  }

  @Post(':id/reenrich')
  @Roles(UserRole.SUPER_ADMIN)
  reenrich(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() actor: Actor) {
    return this.service.reenrich(id, actor);
  }

  /** Привязать клиента (telegram-пользователя), пришедшего от лида. */
  @Post(':id/link-client')
  @Roles(UserRole.SUPER_ADMIN)
  linkClient(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: LinkClientDto,
    @CurrentUser() actor: Actor,
  ) {
    return this.service.linkClient(id, dto.telegramUserId, actor);
  }

  /** Снять привязку клиента. */
  @Delete(':id/link-client')
  @Roles(UserRole.SUPER_ADMIN)
  unlinkClient(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() actor: Actor) {
    return this.service.unlinkClient(id, actor);
  }

  /** Привязка клиента к лиду по deep-link из client-bot (X-Internal-Key, best-effort). */
  @Post(':id/attach-client')
  @Internal()
  attachClient(@Param('id', ParseUUIDPipe) id: string, @Body() dto: LinkClientDto) {
    return this.service.attachClientFromBot(id, dto.telegramUserId);
  }

  @Delete(':id')
  @Roles(UserRole.SUPER_ADMIN)
  remove(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() actor: Actor) {
    return this.service.remove(id, actor);
  }
}
