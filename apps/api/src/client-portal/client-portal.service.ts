import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  ClientBalanceService,
  DepositTransactionView,
} from '../balance/client-balance.service';
import { ErrorCode } from '../common/error-codes';
import { paginate, PaginatedResponse } from '../common/interfaces/paginated';
import { buildOutputFileName, getDocumentClientName } from '../common/output-filename';
import { Document, DocumentStatus, documentStatusLabels } from '../database/entities/document.entity';
import { ExcelExportService } from '../documents/excel-export.service';
import { TelegramUsersService } from '../telegram-users/telegram-users.service';
import { ClientDocumentsQueryDto } from './dto/client-documents-query.dto';
import { ResolveClientDto } from './dto/resolve-client.dto';

/** Профиль клиента, возвращаемый при резолве (для выдачи client-JWT в BFF). */
export interface ResolvedClient {
  telegramUserId: string;
  billingAccountId: string;
  firstName: string | null;
  lastName: string | null;
  username: string | null;
  language: string;
}

/** Лёгкая карточка документа для списка в кабинете (без тяжёлых resultData/parsedData). */
export interface ClientDocumentListItem {
  id: string;
  originalFileName: string;
  status: DocumentStatus;
  statusLabel: string;
  rowCount: number;
  createdAt: Date;
  updatedAt: Date;
}

/** Детали документа для кабинета: карточка + построчный результат расчёта. */
export interface ClientDocumentDetail extends ClientDocumentListItem {
  currency: string | null;
  countryOfOrigin: string | null;
  errorMessage: string | null;
  rejectionReasons: string[] | null;
  resultData: Record<string, unknown>[] | null;
}

/**
 * Доменный слой client-scoped internal-эндпоинтов кабинета (/internal/client/*).
 * Вызывается только client-bff'ом по X-Internal-Key. Владелец (billingAccountId)
 * приходит из client-JWT, который BFF уже проверил, — здесь он используется как
 * жёсткий скоуп: документы резолвятся через telegram_users.billing_account_id, и
 * чужой ресурс недоступен (404). Баланс/журнал ключуются аккаунтом напрямую.
 */
@Injectable()
export class ClientPortalService {
  constructor(
    @InjectRepository(Document) private docRepo: Repository<Document>,
    private telegramUsers: TelegramUsersService,
    private balance: ClientBalanceService,
    private excelExport: ExcelExportService,
  ) {}

  /** Upsert клиента по telegramId (заводит BillingAccount, если новый) → identity для JWT. */
  async resolve(dto: ResolveClientDto): Promise<ResolvedClient> {
    const user = await this.telegramUsers.register({
      telegramId: dto.telegramId,
      username: dto.username,
      firstName: dto.firstName,
      lastName: dto.lastName,
      language: dto.language,
    });
    return {
      telegramUserId: user.id,
      billingAccountId: user.billingAccountId,
      firstName: user.firstName,
      lastName: user.lastName,
      username: user.username,
      language: user.language,
    };
  }

  async getBalance(accountId: string): Promise<{ balance: number }> {
    return { balance: await this.balance.getBalance(accountId) };
  }

  async listTransactions(
    accountId: string,
    query: { page: number; limit: number },
  ): Promise<PaginatedResponse<DepositTransactionView>> {
    return this.balance.listTransactions(accountId, query);
  }

  async listDocuments(
    accountId: string,
    query: ClientDocumentsQueryDto,
  ): Promise<PaginatedResponse<ClientDocumentListItem>> {
    // Скоуп по владельцу баланса: документы клиента(ов) этого аккаунта. Join по
    // billing_account_id, а не по telegram_user_id, чтобы переход на 1:N (несколько
    // сотрудников на аккаунт) не потребовал переписывать запрос.
    const qb = this.docRepo
      .createQueryBuilder('d')
      .innerJoin('d.telegramUser', 'tu')
      .where('tu.billing_account_id = :accountId', { accountId });
    if (query.status) qb.andWhere('d.status = :status', { status: query.status });

    const [rows, total] = await qb
      .select([
        'd.id',
        'd.originalFileName',
        'd.status',
        'd.rowCount',
        'd.createdAt',
        'd.updatedAt',
      ])
      .orderBy(`d.${query.sortBy}`, query.sortOrder)
      .skip((query.page - 1) * query.limit)
      .take(query.limit)
      .getManyAndCount();

    return paginate(rows.map((d) => this.toListItem(d)), total, query.page, query.limit);
  }

  async getDocument(accountId: string, documentId: string): Promise<ClientDocumentDetail> {
    const doc = await this.findOwnedDocument(accountId, documentId);
    return {
      ...this.toListItem(doc),
      currency: doc.currency,
      countryOfOrigin: doc.countryOfOrigin,
      errorMessage: doc.errorMessage,
      rejectionReasons: doc.rejectionReasons,
      resultData: doc.resultData,
    };
  }

  /** Готовый Excel результата (только PROCESSED, только свой). */
  async downloadDocument(
    accountId: string,
    documentId: string,
  ): Promise<{ buffer: Buffer; fileName: string }> {
    const doc = await this.findOwnedDocument(accountId, documentId);
    if (doc.status !== DocumentStatus.PROCESSED) {
      throw new NotFoundException({
        code: ErrorCode.DOWNLOAD_NOT_AVAILABLE,
        message: 'Download is only available for successfully processed documents',
      });
    }
    // ExcelExportService.generate отдаёт ExcelJS.Buffer (несовместим по типам с Node Buffer,
    // хотя в рантайме это он же) — приводим к Node Buffer для res.send в контроллере.
    const buffer = Buffer.from((await this.excelExport.generate(doc)) as ArrayBuffer);
    const fileName = buildOutputFileName(doc.createdAt, getDocumentClientName(doc));
    return { buffer, fileName };
  }

  /**
   * Документ, принадлежащий аккаунту, иначе 404. Единый недоступности-ответ для чужого
   * и несуществующего документа: не подтверждаем существование чужих id.
   */
  private async findOwnedDocument(accountId: string, documentId: string): Promise<Document> {
    const doc = await this.docRepo.findOne({
      where: { id: documentId },
      relations: ['telegramUser'],
    });
    if (!doc || doc.telegramUser?.billingAccountId !== accountId) {
      throw new NotFoundException({
        code: ErrorCode.DOCUMENT_NOT_FOUND,
        message: 'Document not found',
      });
    }
    return doc;
  }

  private toListItem(doc: Document): ClientDocumentListItem {
    return {
      id: doc.id,
      originalFileName: doc.originalFileName,
      status: doc.status,
      statusLabel: documentStatusLabels[doc.status] ?? doc.status,
      rowCount: doc.rowCount,
      createdAt: doc.createdAt,
      updatedAt: doc.updatedAt,
    };
  }
}
