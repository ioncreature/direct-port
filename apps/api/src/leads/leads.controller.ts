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
import { Internal } from '../auth/decorators/internal.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { UserRole } from '../database/entities/user.entity';
import { CreateLeadDto } from './dto/create-lead.dto';
import { DiscoverLeadsDto } from './dto/discover-leads.dto';
import { FindLeadsQueryDto } from './dto/find-leads-query.dto';
import { ImportLeadsDto } from './dto/import-leads.dto';
import { LinkClientDto } from './dto/link-client.dto';
import { ReportLeadsDto } from './dto/report-leads.dto';
import { UpdateLeadDto } from './dto/update-lead.dto';
import { LeadsService } from './leads.service';

@Controller('leads')
export class LeadsController {
  constructor(private service: LeadsService) {}

  @Get()
  @Roles(UserRole.ADMIN, UserRole.CUSTOMS)
  findAll(@Query() query: FindLeadsQueryDto) {
    return this.service.findAll(query);
  }

  @Get('status-counts')
  @Roles(UserRole.ADMIN, UserRole.CUSTOMS)
  statusCounts() {
    return this.service.getStatusCounts();
  }

  @Get('searches')
  @Roles(UserRole.ADMIN, UserRole.CUSTOMS)
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
    return this.service.discover(dto);
  }

  /** Дайджест свежих горячих лидов за период (часы); порог score настраивается агентом. */
  @Get('agent/digest')
  @Internal()
  agentDigest(@Query('hours') hours?: string, @Query('minScore') minScore?: string) {
    const parsedScore = Number(minScore);
    return this.service.getDigest(
      Math.min(Number(hours) || 24, 168),
      Number.isFinite(parsedScore) ? Math.min(Math.max(parsedScore, 0), 1) : undefined,
    );
  }

  /** Доставить готовый отчёт менеджерам в Telegram. */
  @Post('agent/report')
  @Internal()
  agentReport(@Body() dto: ReportLeadsDto) {
    return this.service.reportToManagers(dto.text);
  }

  @Get('export')
  @Roles(UserRole.ADMIN, UserRole.CUSTOMS)
  async export(@Query() query: FindLeadsQueryDto, @Res() res: Response) {
    const csv = await this.service.exportCsv(query);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="leads.csv"');
    res.send(csv);
  }

  @Post()
  @Roles(UserRole.ADMIN, UserRole.CUSTOMS)
  create(@Body() dto: CreateLeadDto) {
    return this.service.create(dto);
  }

  @Post('discover')
  @Roles(UserRole.ADMIN, UserRole.CUSTOMS)
  discover(@Body() dto: DiscoverLeadsDto) {
    return this.service.discover(dto);
  }

  @Post('import')
  @Roles(UserRole.ADMIN, UserRole.CUSTOMS)
  import(@Body() dto: ImportLeadsDto) {
    return this.service.import(dto);
  }

  @Get(':id')
  @Roles(UserRole.ADMIN, UserRole.CUSTOMS)
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.findOne(id);
  }

  @Patch(':id')
  @Roles(UserRole.ADMIN, UserRole.CUSTOMS)
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateLeadDto) {
    return this.service.update(id, dto);
  }

  @Post(':id/reenrich')
  @Roles(UserRole.ADMIN, UserRole.CUSTOMS)
  reenrich(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.reenrich(id);
  }

  /** Привязать клиента (telegram-пользователя), пришедшего от лида. */
  @Post(':id/link-client')
  @Roles(UserRole.ADMIN, UserRole.CUSTOMS)
  linkClient(@Param('id', ParseUUIDPipe) id: string, @Body() dto: LinkClientDto) {
    return this.service.linkClient(id, dto.telegramUserId);
  }

  /** Снять привязку клиента. */
  @Delete(':id/link-client')
  @Roles(UserRole.ADMIN, UserRole.CUSTOMS)
  unlinkClient(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.unlinkClient(id);
  }

  @Delete(':id')
  @Roles(UserRole.ADMIN, UserRole.CUSTOMS)
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.remove(id);
  }
}
