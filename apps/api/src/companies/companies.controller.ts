import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { Roles } from '../auth/decorators/roles.decorator';
import { UserRole } from '../database/entities/user.entity';
import { CompaniesService } from './companies.service';
import { CreateCompanyDto } from './dto/create-company.dto';
import { FindCompaniesQueryDto } from './dto/find-companies-query.dto';
import { UpdateCompanyDto } from './dto/update-company.dto';

/**
 * Управление компаниями (тенантами) — только глобальный super_admin. admin/customs
 * получают 403: имя компании и сам список тенантов скрыты от пользователей компаний.
 */
@Controller('companies')
@Roles(UserRole.SUPER_ADMIN)
export class CompaniesController {
  constructor(private companiesService: CompaniesService) {}

  @Get()
  findAll(@Query() query: FindCompaniesQueryDto) {
    return this.companiesService.findAll(query);
  }

  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.companiesService.findOne(id);
  }

  @Post()
  create(@Body() dto: CreateCompanyDto) {
    return this.companiesService.create(dto);
  }

  @Patch(':id')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateCompanyDto) {
    return this.companiesService.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.companiesService.remove(id);
  }
}
