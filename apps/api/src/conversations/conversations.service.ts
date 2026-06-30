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
import { IsNull, Repository } from 'typeorm';
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
import { DELIVERY_JOB_OPTS } from './queue-opts';

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

  /** Компания клиента для денормализации в сообщения переписки (NULL до claim). */
  private async resolveClientCompany(clientId: string): Promise<string | null> {
    const client = await this.clientsRepo.findOne({
      where: { id: clientId },
      select: ['companyId'],
    });
    return client?.companyId ?? null;
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
    companyId?: string | null;
    text?: string | null;
    attachmentType?: ConversationAttachmentType | null;
    attachmentFileId?: string | null;
    documentId?: string | null;
    telegramMessageId?: number | string | null;
  }): Promise<ConversationMessage> {
    const companyId =
      input.companyId !== undefined
        ? input.companyId
        : await this.resolveClientCompany(input.clientId);
    const msg = this.messagesRepo.create({
      clientId: input.clientId,
      companyId,
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
    companyId?: string | null;
    text?: string | null;
    attachmentType?: ConversationAttachmentType | null;
    documentId?: string | null;
  }): Promise<ConversationMessage> {
    const companyId =
      input.companyId !== undefined
        ? input.companyId
        : await this.resolveClientCompany(input.clientId);
    const msg = this.messagesRepo.create({
      clientId: input.clientId,
      companyId,
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

  /**
   * Горизонтальная изоляция managed-флоу: менеджер может писать/слать расчёт и
   * запускать пайплайн только по своим закреплённым клиентам. Без этой проверки
   * любой привязанный менеджер (или бот с internal-ключом) мог бы вклиниться в
   * чужой диалог по известному из broadcast clientId.
   */
  private assertClientAssignedTo(client: TelegramUser, manager: User): void {
    if (client.assignedManagerId !== manager.id) {
      throw new ForbiddenException({
        code: ErrorCode.CLIENT_NOT_ASSIGNED,
        message: 'Client is assigned to another manager',
      });
    }
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
    // Клиент входит в компанию закрепившего менеджера; его уже присланные документы и
    // сообщения без компании наследуют её (история, привязанная к другой компании, не
    // трогается). Боты пока общие на платформу, поэтому компания клиента определяется
    // именно в момент claim.
    if (manager.companyId) {
      // Независимые UPDATE'ы разных таблиц — параллельно.
      await Promise.all([
        this.clientsRepo.update({ id: clientId }, { companyId: manager.companyId }),
        this.documents.assignCompanyToClientDocs(clientId, manager.companyId),
        this.messagesRepo.update(
          { clientId, companyId: IsNull() },
          { companyId: manager.companyId },
        ),
      ]);
    }
    // Один раз сообщаем клиенту, что менеджер подключился (а не на каждое его сообщение).
    // Best-effort: claim уже состоялся, ронять его из-за недоступной очереди нельзя —
    // клиент лишь не увидит «менеджер на связи».
    await this.enqueueClientOutgoing({
      companyId: client.companyId,
      clientTelegramId: client.telegramId,
      language: client.language,
      i18nKey: 'manager-assigned',
    }).catch((err) =>
      this.logger.warn(`Failed to enqueue manager-assigned notice for ${clientId}`, err),
    );
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
    this.assertClientAssignedTo(client, manager);
    await this.appendManagerMessage({
      clientId,
      managerId: manager.id,
      companyId: client.companyId,
      text,
    });
    await this.enqueueClientOutgoing({
      companyId: client.companyId,
      clientTelegramId: client.telegramId,
      text,
      language: client.language,
    });
    return { ok: true };
  }

  /**
   * Кладёт исходящее сообщение клиенту в очередь client-bot-outgoing (доставляет client-bot).
   * Сбой постановки НЕ глотается: раньше при недоступном Redis метод возвращал успех,
   * менеджер видел «✅ Отправлено клиенту», а сообщение не уходило никогда. Теперь
   * вызвавший экшен отвечает 500 — менеджер видит ошибку и повторяет.
   */
  private async enqueueClientOutgoing(payload: ClientOutgoingMessage): Promise<void> {
    await this.clientOutQueue.add('client-message', payload, DELIVERY_JOB_OPTS);
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
    this.assertClientAssignedTo(client, manager);
    await this.appendManagerMessage({
      clientId: client.id,
      managerId: manager.id,
      companyId: client.companyId,
      attachmentType: 'document',
      documentId: doc.id,
    });
    await this.enqueueClientOutgoing({
      companyId: client.companyId,
      clientTelegramId: client.telegramId,
      language: client.language,
      documentId: doc.id,
      documentFileName: doc.originalFileName,
    });
    return { ok: true };
  }

  /** Запуск пайплайна по документу менеджером (после резолва его привязки). */
  async startDocumentByManager(
    managerTelegramId: string,
    documentId: string,
  ): Promise<Document> {
    const manager = await this.resolveManagerOrThrow(managerTelegramId);
    const doc = await this.documents.findOne(documentId);
    if (doc.telegramUser) {
      this.assertClientAssignedTo(doc.telegramUser, manager);
    }
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
    // На случай перепривязки этого telegramId к другому аккаунту — снять старую привязку
    // и освободить клиентов прежнего владельца (он остаётся без Telegram и не получил бы
    // их уведомлений).
    const previousOwners = await this.usersRepo.find({
      where: { managerTelegramId: telegramId },
      select: ['id'],
    });
    await this.usersRepo.update({ managerTelegramId: telegramId }, { managerTelegramId: null });
    for (const prev of previousOwners) {
      if (prev.id !== user.id) await this.releaseManagerClients(prev.id);
    }
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
    await this.releaseManagerClients(userId);
  }

  /**
   * Возвращает клиентов отвязанного менеджера в общий пул (broadcast). Без этого они
   * попадали в «чёрную дыру»: уведомления адресуются назначенному менеджеру, которого
   * больше нет в Telegram, fallback не срабатывал, а claim другим менеджером отбивался
   * 409 — сообщения таких клиентов копились в БД незамеченными.
   */
  private async releaseManagerClients(managerId: string): Promise<void> {
    const res = await this.clientsRepo.update(
      { assignedManagerId: managerId },
      { assignedManagerId: null },
    );
    if (res.affected) {
      this.logger.log(
        `Released ${res.affected} client(s) of unlinked manager ${managerId} back to broadcast pool`,
      );
    }
  }
}
