import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { MulterOptions } from '@nestjs/platform-express/multer/interfaces/multer-options.interface';
import { Response } from 'express';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { UserRole } from '../database/entities/user.entity';
import { DocumentsService } from './documents.service';
import { CreateDocumentDto } from './dto/create-document.dto';
import { FindDocumentsQueryDto } from './dto/find-documents-query.dto';
import { RejectDocumentDto } from './dto/reject-document.dto';
import { ReviewDocumentDto } from './dto/review-document.dto';
import { UploadDocumentDto } from './dto/upload-document.dto';
import { ExcelExportService } from './excel-export.service';

const SPREADSHEET_UPLOAD: MulterOptions = {
  limits: { fileSize: 15 * 1024 * 1024 },
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
  async upload(@UploadedFile() file: Express.Multer.File, @Body() dto: UploadDocumentDto) {
    if (!file) throw new BadRequestException('File is required');
    return this.service.createFromFile(file.buffer, file.originalname, {
      telegramUserId: dto.telegramUserId,
    });
  }

  @Post('upload-admin')
  @Roles(UserRole.ADMIN, UserRole.CUSTOMS)
  @UseInterceptors(FileInterceptor('file', SPREADSHEET_UPLOAD))
  async uploadAdmin(
    @UploadedFile() file: Express.Multer.File,
    @CurrentUser() user: { id: string },
  ) {
    if (!file) throw new BadRequestException('File is required');
    return this.service.createFromFile(file.buffer, file.originalname, {
      uploadedByUserId: user.id,
    });
  }

  @Get()
  @Roles(UserRole.ADMIN, UserRole.CUSTOMS)
  findAll(@Query() query: FindDocumentsQueryDto) {
    return this.service.findAll(query);
  }

  @Patch(':id/review')
  @Roles(UserRole.ADMIN, UserRole.CUSTOMS)
  review(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ReviewDocumentDto) {
    return this.service.updateParsedData(id, dto);
  }

  @Post(':id/reject')
  @Roles(UserRole.ADMIN, UserRole.CUSTOMS)
  reject(@Param('id', ParseUUIDPipe) id: string, @Body() dto: RejectDocumentDto) {
    return this.service.reject(id, dto);
  }

  @Post(':id/reprocess')
  @Roles(UserRole.ADMIN, UserRole.CUSTOMS)
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
  async download(@Param('id', ParseUUIDPipe) id: string, @Res() res: Response) {
    await this.sendExcel(id, res);
  }

  /** Внутренний endpoint для бота (auth через X-Internal-Key, без @Roles) */
  @Get(':id/download-internal')
  async downloadInternal(@Param('id', ParseUUIDPipe) id: string, @Res() res: Response) {
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
