import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Res } from '@nestjs/common';
import { Response } from 'express';
import { DocumentsService } from './documents.service';
import { ExcelExportService } from './excel-export.service';
import { CreateDocumentDto } from './dto/create-document.dto';
import { Roles } from '../auth/decorators/roles.decorator';
import { UserRole } from '../database/entities/user.entity';

@Controller('documents')
export class DocumentsController {
  constructor(
    private service: DocumentsService,
    private excelExport: ExcelExportService,
  ) {}

  @Post()
  create(@Body() dto: CreateDocumentDto) {
    return this.service.create(dto);
  }

  @Get()
  @Roles(UserRole.ADMIN, UserRole.CUSTOMS)
  findAll() {
    return this.service.findAll();
  }

  @Get(':id')
  @Roles(UserRole.ADMIN, UserRole.CUSTOMS)
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.findOne(id);
  }

  @Get(':id/download')
  @Roles(UserRole.ADMIN, UserRole.CUSTOMS)
  async download(
    @Param('id', ParseUUIDPipe) id: string,
    @Res() res: Response,
  ) {
    await this.sendExcel(id, res);
  }

  /** Внутренний endpoint для бота (auth через X-Internal-Key, без @Roles) */
  @Get(':id/download-internal')
  async downloadInternal(
    @Param('id', ParseUUIDPipe) id: string,
    @Res() res: Response,
  ) {
    await this.sendExcel(id, res);
  }

  private async sendExcel(id: string, res: Response) {
    const doc = await this.service.findOne(id);
    const buffer = await this.excelExport.generate(doc);

    const fileName = encodeURIComponent(doc.originalFileName || 'document.xlsx');
    res.set({
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${fileName}"`,
    });

    res.send(buffer);
  }
}
