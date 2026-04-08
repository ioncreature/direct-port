import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { MulterOptions } from '@nestjs/platform-express/multer/interfaces/multer-options.interface';
import { Response } from 'express';
import { DocumentsService } from './documents.service';
import { ExcelExportService } from './excel-export.service';
import { CreateDocumentDto } from './dto/create-document.dto';
import { UploadDocumentDto } from './dto/upload-document.dto';
import { FindDocumentsQueryDto } from './dto/find-documents-query.dto';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { UserRole } from '../database/entities/user.entity';

const SPREADSHEET_UPLOAD: MulterOptions = {
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ext = file.originalname.split('.').pop()?.toLowerCase();
    if (ext === 'xlsx' || ext === 'csv') cb(null, true);
    else cb(new BadRequestException('Only .xlsx and .csv files are supported'), false);
  },
};

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

  @Post('upload')
  @UseInterceptors(FileInterceptor('file', SPREADSHEET_UPLOAD))
  async upload(
    @UploadedFile() file: Express.Multer.File,
    @Body() dto: UploadDocumentDto,
  ) {
    if (!file) throw new BadRequestException('File is required');
    return this.service.createFromFile(file.buffer, file.originalname, { telegramUserId: dto.telegramUserId });
  }

  @Post('upload-admin')
  @Roles(UserRole.ADMIN)
  @UseInterceptors(FileInterceptor('file', SPREADSHEET_UPLOAD))
  async uploadAdmin(
    @UploadedFile() file: Express.Multer.File,
    @CurrentUser() user: { id: string },
  ) {
    if (!file) throw new BadRequestException('File is required');
    return this.service.createFromFile(file.buffer, file.originalname, { uploadedByUserId: user.id });
  }

  @Get()
  @Roles(UserRole.ADMIN, UserRole.CUSTOMS)
  findAll(@Query() query: FindDocumentsQueryDto) {
    return this.service.findAll(query);
  }

  @Post(':id/reprocess')
  @Roles(UserRole.ADMIN)
  reprocess(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.reprocess(id);
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
