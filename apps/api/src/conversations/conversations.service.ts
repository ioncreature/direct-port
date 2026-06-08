import { InjectQueue } from '@nestjs/bullmq';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Queue } from 'bullmq';
import { Repository } from 'typeorm';
import { ErrorCode } from '../common/error-codes';
import {
  type ConversationAttachmentType,
  ConversationMessage,
} from '../database/entities/conversation-message.entity';
import { Document, DocumentStatus } from '../database/entities/document.entity';
import { TelegramUser } from '../database/entities/telegram-user.entity';
import { User } from '../database/entities/user.entity';
import { DocumentsService } from '../documents/documents.service';
import type { ClientOutgoingMessage } from './client-outgoing';
import { ManagerLinkService } from './manager-link.service';

@Injectable()
export class ConversationsService {
  private logger = new Logger(ConversationsService.name);

  constructor(
    @InjectRepository(ConversationMessage)
    private messagesRepo: Repository<ConversationMessage>,
    @InjectRepository(TelegramUser) private clientsRepo: Repository<TelegramUser>,
    @InjectRepository(User) private usersRepo: Repository<User>,
    @InjectQueue('client-bot-outgoing') private clientOutQueue: Queue,
    private linkService: ManagerLinkService,
    private documents: DocumentsService,
  ) {}

  async resolveClientOrThrow(clientId: string): Promise<TelegramUser> {
    const client = await this.clientsRepo.findOne({ where: { id: clientId } });
    if (!client) {
      throw new NotFoundException({
        code: ErrorCode.UNKNOWN_ROW,
        message: 'Client not found',
      });
    }
    return client;
  }

  async resolveManagerOrThrow(managerTelegramId: string): Promise<User> {
    const manager = await this.usersRepo.findOne({ where: { managerTelegramId } });
    if (!manager || !manager.isActive) {
      throw new ForbiddenException({
        code: ErrorCode.MANAGER_NOT_LINKED,
        message: 'Manager Telegram is not linked',
      });
    }
    return manager;
  }

  async appendClientMessage(input: {
    clientId: string;
    text?: string | null;
    attachmentType?: ConversationAttachmentType | null;
    attachmentFileId?: string | null;
    documentId?: string | null;
    telegramMessageId?: number | string | null;
  }): Promise<ConversationMessage> {
    const msg = this.messagesRepo.create({
      clientId: input.clientId,
      direction: 'client_to_manager',
      managerId: null,
      text: input.text ?? null,
      attachmentType: input.attachmentType ?? null,
      attachmentFileId: input.attachmentFileId ?? null,
      documentId: input.documentId ?? null,
      telegramMessageId:
        input.telegramMessageId != null ? String(input.telegramMessageId) : null,
    });
    return this.messagesRepo.save(msg);
  }

  async appendManagerMessage(input: {
    clientId: string;
    managerId: string;
    text?: string | null;
    attachmentType?: ConversationAttachmentType | null;
    documentId?: string | null;
  }): Promise<ConversationMessage> {
    const msg = this.messagesRepo.create({
      clientId: input.clientId,
      direction: 'manager_to_client',
      managerId: input.managerId,
      text: input.text ?? null,
      attachmentType: input.attachmentType ?? null,
      documentId: input.documentId ?? null,
    });
    return this.messagesRepo.save(msg);
  }

  /** История переписки клиента (read-only таб в админке). */
  async listByClient(clientId: string): Promise<ConversationMessage[]> {
    return this.messagesRepo.find({
      where: { clientId },
      relations: ['manager'],
      order: { createdAt: 'ASC' },
    });
  }

  /** Клиенты, закреплённые за менеджером (для /clients в боте). */
  async listManagerClients(managerTelegramId: string): Promise<TelegramUser[]> {
    const manager = await this.resolveManagerOrThrow(managerTelegramId);
    return this.clientsRepo.find({
      where: { assignedManagerId: manager.id },
      order: { updatedAt: 'DESC' },
    });
  }

  /** Закрепить клиента за менеджером (claim). Атомарно — гонка двух менеджеров даёт 409. */
  async claimByManagerTelegram(
    clientId: string,
    managerTelegramId: string,
  ): Promise<{ clientId: string; managerId: string }> {
    const manager = await this.resolveManagerOrThrow(managerTelegramId);
    const client = await this.resolveClientOrThrow(clientId);
    if (client.assignedManagerId === manager.id) {
      return { clientId, managerId: manager.id };
    }
    const res = await this.clientsRepo
      .createQueryBuilder()
      .update(TelegramUser)
      .set({ assignedManagerId: manager.id })
      .where('id = :id AND assigned_manager_id IS NULL', { id: clientId })
      .execute();
    if (!res.affected) {
      throw new ConflictException({
        code: ErrorCode.CLIENT_ALREADY_CLAIMED,
        message: 'Client already claimed by another manager',
      });
    }
    return { clientId, managerId: manager.id };
  }

  /** Ответ менеджера клиенту: сохранить в БД + поставить в очередь доставки. */
  async managerReply(
    managerTelegramId: string,
    clientId: string,
    text: string,
  ): Promise<{ ok: true }> {
    const manager = await this.resolveManagerOrThrow(managerTelegramId);
    const client = await this.resolveClientOrThrow(clientId);
    await this.appendManagerMessage({ clientId, managerId: manager.id, text });
    await this.enqueueClientOutgoing(
      { clientTelegramId: client.telegramId, text, language: client.language },
      clientId,
    );
    return { ok: true };
  }

  /** Кладёт исходящее сообщение клиенту в очередь client-bot-outgoing (доставляет client-bot). */
  private async enqueueClientOutgoing(
    payload: ClientOutgoingMessage,
    clientId: string,
  ): Promise<void> {
    await this.clientOutQueue
      .add('client-message', payload)
      .catch((err) => this.logger.warn(`Failed to enqueue client message for ${clientId}`, err));
  }

  /**
   * Отправка готового расчёта (Excel) клиенту по кнопке менеджера.
   * Сам файл не возим через очередь — client-bot скачает его по documentId
   * (download-internal). Доступно только для PROCESSED — иначе download недоступен.
   */
  async sendDocumentToClient(
    managerTelegramId: string,
    documentId: string,
  ): Promise<{ ok: true }> {
    const manager = await this.resolveManagerOrThrow(managerTelegramId);
    const doc = await this.documents.findOne(documentId);
    if (doc.status !== DocumentStatus.PROCESSED) {
      throw new BadRequestException({
        code: ErrorCode.DOWNLOAD_NOT_AVAILABLE,
        message: 'Result file is available only for processed documents',
      });
    }
    // telegramUser уже загружен relation'ом в findOne — второй запрос не нужен.
    const client = doc.telegramUser;
    if (!client) {
      throw new BadRequestException({
        code: ErrorCode.UNKNOWN_ROW,
        message: 'Document has no client to deliver to',
      });
    }
    await this.appendManagerMessage({
      clientId: client.id,
      managerId: manager.id,
      attachmentType: 'document',
      documentId: doc.id,
    });
    await this.enqueueClientOutgoing(
      {
        clientTelegramId: client.telegramId,
        language: client.language,
        documentId: doc.id,
        documentFileName: doc.originalFileName,
      },
      client.id,
    );
    return { ok: true };
  }

  /** Запуск пайплайна по документу менеджером (после резолва его привязки). */
  async startDocumentByManager(
    managerTelegramId: string,
    documentId: string,
  ): Promise<Document> {
    await this.resolveManagerOrThrow(managerTelegramId);
    return this.documents.startProcessing(documentId);
  }

  /** Привязка менеджерского Telegram к User по одноразовому токену. */
  async linkManager(token: string, telegramId: string): Promise<{ userId: string }> {
    const userId = await this.linkService.consumeToken(token);
    if (!userId) {
      throw new BadRequestException({
        code: ErrorCode.INVALID_LINK_TOKEN,
        message: 'Link token invalid or expired',
      });
    }
    const user = await this.usersRepo.findOne({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException({ code: ErrorCode.UNKNOWN_ROW, message: 'User not found' });
    }
    // На случай перепривязки этого telegramId к другому аккаунту — снять старую привязку.
    await this.usersRepo.update({ managerTelegramId: telegramId }, { managerTelegramId: null });
    user.managerTelegramId = telegramId;
    await this.usersRepo.save(user);
    this.logger.log(`Manager linked: user=${user.id} telegram=${telegramId}`);
    return { userId: user.id };
  }

  async unlinkManager(userId: string): Promise<void> {
    const user = await this.usersRepo.findOne({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException({ code: ErrorCode.UNKNOWN_ROW, message: 'User not found' });
    }
    user.managerTelegramId = null;
    await this.usersRepo.save(user);
  }
}
