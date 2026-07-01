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
import { Response } from 'express';
import { Internal } from '../auth/decorators/internal.decorator';
import { ErrorCode } from '../common/error-codes';
import { xlsxDownloadHeaders } from '../common/excel-download';
import { SPREADSHEET_UPLOAD } from '../common/spreadsheet-upload';
import { TopUpService } from '../top-up/top-up.service';
import { ClientPortalService } from './client-portal.service';
import { ClientDocumentsQueryDto } from './dto/client-documents-query.dto';
import { CreateTopUpDto } from './dto/create-top-up.dto';
import { ResolveClientDto } from './dto/resolve-client.dto';
import { UploadClientDocumentDto } from './dto/upload-document.dto';
import { VerifyTelegramDto } from './dto/verify-telegram.dto';
import { TelegramVerifyService } from './telegram-verify.service';

/**
 * Client-scoped internal-эндпоинты кабинета (auth ТОЛЬКО по X-Internal-Key, @Internal).
 * Единственный потребитель — client-bff. accountId в пути приходит из проверенного
 * client-JWT (BFF никогда не берёт его из тела клиентского запроса). Сервис скоупит
 * каждый ресурс по этому accountId и отдаёт 404 на чужое.
 */
@Controller('internal/client')
export class ClientPortalController {
  constructor(
    private service: ClientPortalService,
    private topUp: TopUpService,
    private telegramVerify: TelegramVerifyService,
  ) {}

  /** Публичная инфа компании по slug (pre-login: для рендера виджета входа). Нет slug → дефолтная. */
  @Get('company')
  @Internal()
  company(@Query('slug') slug?: string) {
    return this.telegramVerify.resolveCompany(slug);
  }

  /** Верификация подписи Telegram Login Widget токеном client-bot компании (по slug). */
  @Post('verify-telegram')
  @Internal()
  verifyTelegram(@Body() dto: VerifyTelegramDto) {
    return this.telegramVerify.verify(dto);
  }

  /** Upsert клиента по Telegram identity → id для выдачи client-JWT. */
  @Post('resolve')
  @Internal()
  resolve(@Body() dto: ResolveClientDto) {
    return this.service.resolve(dto);
  }

  @Get(':accountId/balance')
  @Internal()
  balance(@Param('accountId', ParseUUIDPipe) accountId: string) {
    return this.service.getBalance(accountId);
  }

  @Get(':accountId/transactions')
  @Internal()
  transactions(
    @Param('accountId', ParseUUIDPipe) accountId: string,
    @Query() query: ClientDocumentsQueryDto,
  ) {
    return this.service.listTransactions(accountId, { page: query.page, limit: query.limit });
  }

  @Get(':accountId/documents')
  @Internal()
  documents(
    @Param('accountId', ParseUUIDPipe) accountId: string,
    @Query() query: ClientDocumentsQueryDto,
  ) {
    return this.service.listDocuments(accountId, query);
  }

  @Get(':accountId/documents/:id')
  @Internal()
  document(
    @Param('accountId', ParseUUIDPipe) accountId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.service.getDocument(accountId, id);
  }

  /** Self-service загрузка документа из кабинета (Ф3) → штатный pipeline с автозапуском. */
  @Post(':accountId/documents')
  @Internal()
  @UseInterceptors(FileInterceptor('file', SPREADSHEET_UPLOAD))
  uploadDocument(
    @Param('accountId', ParseUUIDPipe) accountId: string,
    @UploadedFile() file: Express.Multer.File,
    @Body() dto: UploadClientDocumentDto,
  ) {
    if (!file) {
      throw new BadRequestException({
        code: ErrorCode.FILE_REQUIRED,
        message: 'File is required',
      });
    }
    return this.service.uploadDocument(accountId, dto.telegramUserId, file);
  }

  /** Справочник покупаемых пакетов (account-independent). */
  @Get('packages')
  @Internal()
  packages() {
    return this.topUp.getPackages();
  }

  @Post(':accountId/topups')
  @Internal()
  createTopUp(
    @Param('accountId', ParseUUIDPipe) accountId: string,
    @Body() dto: CreateTopUpDto,
  ) {
    return this.topUp.createRequest(accountId, dto.telegramUserId, dto.packageKey);
  }

  @Get(':accountId/topups')
  @Internal()
  topUps(
    @Param('accountId', ParseUUIDPipe) accountId: string,
    @Query() query: ClientDocumentsQueryDto,
  ) {
    return this.topUp.listRequests(accountId, { page: query.page, limit: query.limit });
  }

  @Post(':accountId/topups/:id/cancel')
  @Internal()
  cancelTopUp(
    @Param('accountId', ParseUUIDPipe) accountId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.topUp.cancelOwnRequest(accountId, id);
  }

  @Get(':accountId/documents/:id/download')
  @Internal()
  async download(
    @Param('accountId', ParseUUIDPipe) accountId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Res() res: Response,
  ) {
    const { buffer, fileName } = await this.service.downloadDocument(accountId, id);
    res.set(xlsxDownloadHeaders(fileName));
    res.send(buffer);
  }
}
