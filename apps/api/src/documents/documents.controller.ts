import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Res } from '@nestjs/common';
import { Response } from 'express';
import * as ExcelJS from 'exceljs';
import { DocumentsService } from './documents.service';
import { CreateDocumentDto } from './dto/create-document.dto';
import { Roles } from '../auth/decorators/roles.decorator';
import { UserRole } from '../database/entities/user.entity';

@Controller('documents')
export class DocumentsController {
  constructor(private service: DocumentsService) {}

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
    const doc = await this.service.findOne(id);
    const data = doc.resultData ?? doc.parsedData ?? [];

    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Данные');

    if (data.length > 0) {
      const headers = Object.keys(data[0]);
      sheet.addRow(headers);
      for (const row of data) {
        sheet.addRow(headers.map((h) => row[h]));
      }
    }

    const fileName = encodeURIComponent(doc.originalFileName || 'document.xlsx');
    res.set({
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${fileName}"`,
    });

    await workbook.xlsx.write(res);
    res.end();
  }
}
