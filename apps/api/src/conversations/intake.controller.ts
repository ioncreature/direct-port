import {
  BadRequestException,
  Body,
  Controller,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Internal } from '../auth/decorators/internal.decorator';
import { ErrorCode } from '../common/error-codes';
import { SPREADSHEET_UPLOAD } from '../common/spreadsheet-upload';
import { DocumentsService } from '../documents/documents.service';
import { ConversationsService } from './conversations.service';
import { IntakeMessageDto } from './dto/intake-message.dto';
import { IntakeUploadDto } from './dto/intake-upload.dto';
import { ManagerNotifyService } from './manager-notify.service';

/**
 * Приём от client-bot (auth ТОЛЬКО по X-Internal-Key). Файлы сохраняются как
 * managed-документы БЕЗ автозапуска пайплайна (статус INTAKE) — запускает менеджер.
 */
@Controller('intake')
export class IntakeController {
  constructor(
    private documents: DocumentsService,
    private conversations: ConversationsService,
    private managerNotify: ManagerNotifyService,
  ) {}

  @Post('documents')
  @Internal()
  @UseInterceptors(FileInterceptor('file', SPREADSHEET_UPLOAD))
  async intakeDocument(
    @UploadedFile() file: Express.Multer.File,
    @Body() dto: IntakeUploadDto,
  ) {
    if (!file) {
      throw new BadRequestException({
        code: ErrorCode.FILE_REQUIRED,
        message: 'File is required',
      });
    }
    const doc = await this.documents.createFromFile(
      file.buffer,
      file.originalname,
      { telegramUserId: dto.telegramUserId },
      { documentSource: 'managed', autoStart: false },
    );
    const client = await this.conversations.resolveClientOrThrow(dto.telegramUserId);
    await this.conversations.appendClientMessage({
      clientId: client.id,
      attachmentType: 'document',
      attachmentFileId: dto.fileId ?? null,
      documentId: doc.id,
    });
    doc.telegramUser = client;
    await this.managerNotify.notifyNewDocument(doc);
    return { id: doc.id, status: doc.status };
  }

  @Post('messages')
  @Internal()
  async intakeMessage(@Body() dto: IntakeMessageDto) {
    const client = await this.conversations.resolveClientOrThrow(dto.telegramUserId);
    await this.conversations.appendClientMessage({
      clientId: client.id,
      text: dto.text ?? null,
      attachmentType: dto.attachmentType ?? null,
      attachmentFileId: dto.attachmentFileId ?? null,
      telegramMessageId: dto.telegramMessageId ?? null,
    });
    await this.managerNotify.notifyClientMessage(client, {
      text: dto.text,
      attachmentType: dto.attachmentType,
    });
    return { ok: true };
  }
}
