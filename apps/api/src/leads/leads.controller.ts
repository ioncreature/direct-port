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
import { Roles } from '../auth/decorators/roles.decorator';
import { UserRole } from '../database/entities/user.entity';
import { CreateLeadDto } from './dto/create-lead.dto';
import { DiscoverLeadsDto } from './dto/discover-leads.dto';
import { FindLeadsQueryDto } from './dto/find-leads-query.dto';
import { ImportLeadsDto } from './dto/import-leads.dto';
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

  @Delete(':id')
  @Roles(UserRole.ADMIN, UserRole.CUSTOMS)
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.remove(id);
  }
}
