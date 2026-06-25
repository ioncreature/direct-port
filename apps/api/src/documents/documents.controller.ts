import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Response } from 'express';
import { SPREADSHEET_UPLOAD } from '../common/spreadsheet-upload';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Internal } from '../auth/decorators/internal.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { CalculationLogsService } from '../calculation-logs/calculation-logs.service';
import { ErrorCode } from '../common/error-codes';
import { xlsxDownloadHeaders } from '../common/excel-download';
import { buildOutputFileName, getDocumentClientName } from '../common/output-filename';
import { Actor, resolveCompanyScope } from '../common/tenant/actor-context';
import { DocumentStatus } from '../database/entities/document.entity';
import { UserRole } from '../database/entities/user.entity';
import { DiagnosticsService } from '../diagnostics/diagnostics.service';
import { DocumentsService } from './documents.service';
import { ClarifyRowDto } from './dto/clarify-row.dto';
import { CreateDocumentDto } from './dto/create-document.dto';
import { FindDocumentsQueryDto } from './dto/find-documents-query.dto';
import { RecalculateDocumentDto } from './dto/recalculate-document.dto';
import { RejectDocumentDto } from './dto/reject-document.dto';
import { ReviewDocumentDto } from './dto/review-document.dto';
import { SetRowCodeDto } from './dto/set-row-code.dto';
import { UploadAdminDto } from './dto/upload-admin.dto';
import { UploadDocumentDto } from './dto/upload-document.dto';
import { ExcelExportService } from './excel-export.service';
import { ManualCodeService } from './manual-code.service';

@Controller('documents')
export class DocumentsController {
  constructor(
    private service: DocumentsService,
    private excelExport: ExcelExportService,
    private calculationLogs: CalculationLogsService,
    private diagnostics: DiagnosticsService,
    private manualCode: ManualCodeService,
  ) {}

  @Post()
  @Internal()
  create(@Body() dto: CreateDocumentDto) {
    return this.service.create(dto);
  }

  @Post('upload')
  @Internal()
  @UseInterceptors(FileInterceptor('file', SPREADSHEET_UPLOAD))
  async upload(@UploadedFile() file: Express.Multer.File, @Body() dto: UploadDocumentDto) {
    if (!file)
      throw new BadRequestException({
        code: ErrorCode.FILE_REQUIRED,
        message: 'File is required',
      });
    return this.service.createFromFile(file.buffer, file.originalname, {
      telegramUserId: dto.telegramUserId,
    });
  }

  @Post('upload-admin')
  @Roles(UserRole.ADMIN, UserRole.CUSTOMS)
  @UseInterceptors(FileInterceptor('file', SPREADSHEET_UPLOAD))
  async uploadAdmin(
    @UploadedFile() file: Express.Multer.File,
    @Body() dto: UploadAdminDto,
    @CurrentUser() user: Actor,
  ) {
    if (!file)
      throw new BadRequestException({
        code: ErrorCode.FILE_REQUIRED,
        message: 'File is required',
      });
    return this.service.createFromFile(
      file.buffer,
      file.originalname,
      { uploadedByUserId: user.id, companyId: user.companyId },
      { freightCost: dto.freightCost, freightCurrency: dto.freightCurrency },
    );
  }

  @Get()
  @Roles(UserRole.ADMIN, UserRole.CUSTOMS)
  findAll(@Query() query: FindDocumentsQueryDto, @CurrentUser() actor: Actor) {
    return this.service.findAll(query, actor);
  }

  @Get('status-counts')
  @Roles(UserRole.ADMIN, UserRole.CUSTOMS)
  getStatusCounts(@CurrentUser() actor: Actor, @Query('companyId') companyId?: string) {
    return this.service.getStatusCounts(resolveCompanyScope(actor, companyId));
  }

  @Get('token-stats')
  @Roles(UserRole.ADMIN)
  getTokenStats(
    @CurrentUser() actor: Actor,
    @Query('model') model?: string,
    @Query('companyId') companyId?: string,
  ) {
    return this.service.getTokenStats(model || undefined, resolveCompanyScope(actor, companyId));
  }

  @Get('token-stats/monthly')
  @Roles(UserRole.ADMIN)
  getMonthlyTotal(@CurrentUser() actor: Actor, @Query('companyId') companyId?: string) {
    return this.service.getMonthlyTotal(resolveCompanyScope(actor, companyId));
  }

  @Get('token-stats/daily')
  @Roles(UserRole.ADMIN)
  getTokenStatsByDay(
    @CurrentUser() actor: Actor,
    @Query('days') days?: string,
    @Query('model') model?: string,
    @Query('companyId') companyId?: string,
  ) {
    return this.service.getTokenStatsByDay(
      Math.min(Number(days) || 30, 90),
      model || undefined,
      resolveCompanyScope(actor, companyId),
    );
  }

  @Patch(':id/review')
  @Roles(UserRole.ADMIN, UserRole.CUSTOMS)
  review(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReviewDocumentDto,
    @CurrentUser() actor: Actor,
  ) {
    return this.service.updateParsedData(id, dto, { userId: actor.id }, actor);
  }

  @Post(':id/reject')
  @Roles(UserRole.ADMIN, UserRole.CUSTOMS)
  reject(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RejectDocumentDto,
    @CurrentUser() actor: Actor,
  ) {
    return this.service.reject(id, dto, actor);
  }

  @Post(':id/approve')
  @Roles(UserRole.ADMIN, UserRole.CUSTOMS)
  approve(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() actor: Actor) {
    return this.service.approve(id, actor);
  }

  @Post(':id/reprocess')
  @Roles(UserRole.ADMIN, UserRole.CUSTOMS)
  reprocess(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() actor: Actor) {
    return this.service.reprocess(id, actor);
  }

  /** Запуск пайплайна для managed-документа в статусе INTAKE (кнопка «Запустить расчёт»). */
  @Post(':id/start')
  @Roles(UserRole.ADMIN, UserRole.CUSTOMS)
  start(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() actor: Actor) {
    return this.service.startProcessing(id, actor);
  }

  @Post(':id/recalculate')
  @Roles(UserRole.ADMIN, UserRole.CUSTOMS)
  recalculate(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RecalculateDocumentDto,
    @CurrentUser() actor: Actor,
  ) {
    return this.service.recalculate(id, dto, actor);
  }

  /**
   * Ручная установка кода ТН ВЭД оператором для конкретной строки документа.
   * Доступно для статусов CODE_REVIEW_REQUIRED и PROCESSED_WITH_ERRORS.
   * Если все строки документа после правки получают confident-код — статус
   * автоматически переводится в PROCESSED.
   */
  @Post(':id/rows/:index/set-code')
  @Roles(UserRole.ADMIN, UserRole.CUSTOMS)
  async setRowCode(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('index', ParseIntPipe) index: number,
    @Body() dto: SetRowCodeDto,
    @CurrentUser() actor: Actor,
  ) {
    await this.service.assertAccess(id, actor);
    return this.manualCode.setRowCode(id, index, dto.tnVedCode);
  }

  // *-internal: auth ТОЛЬКО через X-Internal-Key (@Internal) — JWT пользователя не принимается.
  @Post(':id/rows/:index/set-code-internal')
  @Internal()
  setRowCodeInternal(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('index', ParseIntPipe) index: number,
    @Body() dto: SetRowCodeDto,
  ) {
    return this.manualCode.setRowCode(id, index, dto.tnVedCode);
  }

  @Post(':id/rows/:index/clarify-internal')
  @Internal()
  clarifyRowInternal(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('index', ParseIntPipe) index: number,
    @Body() dto: ClarifyRowDto,
  ) {
    return this.manualCode.clarifyRow(id, index, dto.userNote);
  }

  @Get(':id')
  @Roles(UserRole.ADMIN, UserRole.CUSTOMS)
  findOne(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() actor: Actor) {
    return this.service.findOne(id, actor);
  }

  @Get(':id/calculation-history')
  @Roles(UserRole.ADMIN, UserRole.CUSTOMS)
  async calculationHistory(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() actor: Actor) {
    await this.service.assertAccess(id, actor);
    return this.calculationLogs.findByDocumentId(id);
  }

  @Get(':id/stage-runs')
  @Roles(UserRole.ADMIN, UserRole.CUSTOMS)
  async stageRuns(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() actor: Actor) {
    await this.service.assertAccess(id, actor);
    return this.diagnostics.findStageRunsByDocument(id);
  }

  @Get(':id/regulatory-explanations')
  @Roles(UserRole.ADMIN, UserRole.CUSTOMS)
  regulatoryExplanations(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: Actor,
    @Query('lang') lang?: string,
  ) {
    return this.service.getRegulatoryExplanations(id, lang, actor);
  }

  @Get(':id/ai-calls/:callId')
  @Roles(UserRole.ADMIN, UserRole.CUSTOMS)
  async aiCall(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('callId', ParseUUIDPipe) callId: string,
    @CurrentUser() actor: Actor,
  ) {
    await this.service.assertAccess(id, actor);
    return this.diagnostics.findAiCallById(id, callId);
  }

  @Get(':id/versions')
  @Roles(UserRole.ADMIN, UserRole.CUSTOMS)
  async versions(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() actor: Actor) {
    await this.service.assertAccess(id, actor);
    return this.diagnostics.findVersionsByDocument(id);
  }

  @Get(':id/versions/:version')
  @Roles(UserRole.ADMIN, UserRole.CUSTOMS)
  async version(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('version', ParseIntPipe) version: number,
    @CurrentUser() actor: Actor,
  ) {
    await this.service.assertAccess(id, actor);
    return this.diagnostics.findVersionByNumber(id, version);
  }

  @Get(':id/download')
  @Roles(UserRole.ADMIN, UserRole.CUSTOMS)
  async download(
    @Param('id', ParseUUIDPipe) id: string,
    @Res() res: Response,
    @CurrentUser() actor: Actor,
  ) {
    await this.sendExcel(id, res, actor);
  }

  /** Внутренний endpoint для бота (auth ТОЛЬКО через X-Internal-Key) */
  @Get(':id/download-internal')
  @Internal()
  async downloadInternal(@Param('id', ParseUUIDPipe) id: string, @Res() res: Response) {
    await this.sendExcel(id, res);
  }

  private async sendExcel(id: string, res: Response, actor?: Actor) {
    const doc = await this.service.findOne(id, actor);
    if (doc.status !== DocumentStatus.PROCESSED) {
      throw new BadRequestException({
        code: ErrorCode.DOWNLOAD_NOT_AVAILABLE,
        message: 'Download is only available for successfully processed documents',
      });
    }
    const buffer = await this.excelExport.generate(doc);

    const clientName = getDocumentClientName(doc);
    const outputName = buildOutputFileName(doc.createdAt, clientName);
    res.set(xlsxDownloadHeaders(outputName));
    res.send(buffer);
  }
}
