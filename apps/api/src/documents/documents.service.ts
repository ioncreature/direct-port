import { InjectQueue } from '@nestjs/bullmq';
import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Queue } from 'bullmq';
import { FindOptionsWhere, IsNull, Repository } from 'typeorm';
import { ErrorCode } from '../common/error-codes';
import {
  InvalidFreightError,
  normalizeFreightInput,
  type NormalizedFreight,
} from '../common/freight';
import { ClientBalanceService } from '../balance/client-balance.service';
import { paginate, PaginatedResponse } from '../common/interfaces/paginated';
import { normalizeOksmtCode } from '../common/oksmt';
import { Actor, assertSameCompany, resolveCompanyScope } from '../common/tenant/actor-context';
import { CountriesService } from '../countries/countries.service';
import { AiUsageLog } from '../database/entities/ai-usage-log.entity';
import {
  Document,
  DocumentStatus,
  type DocumentSource,
  type FreightCurrency,
} from '../database/entities/document.entity';
import { TelegramUser } from '../database/entities/telegram-user.entity';
import { PipelineAuditService } from '../pipeline-audit/pipeline-audit.service';
import type { RegulatoryExplanation, RegulatoryItem, RegulatoryReport } from '../regulatory/interfaces';
import { RegulatoryInterpreterService } from '../regulatory/regulatory-interpreter.service';
import { RegulatoryRequirementsService } from '../regulatory/regulatory-requirements.service';
import { CreateDocumentDto } from './dto/create-document.dto';
import { FindDocumentsQueryDto } from './dto/find-documents-query.dto';
import { RejectDocumentDto } from './dto/reject-document.dto';
import { ReviewDocumentDto } from './dto/review-document.dto';
import { PipelineNotifierService } from './pipeline-notifier.service';
import { PhotoStorageService } from '../photo-storage/photo-storage.service';

/**
 * Ретраи парсинга на уровне BullMQ: транзиентный сбой Anthropic (529/таймаут) не должен
 * с первой же попытки ронять документ в FAILED. Воркер ставит FAILED только на последней
 * попытке и сохраняет fileBuffer, guard статуса гасит повтор после успеха
 * (см. DocumentsParsingProcessor). У processing-job ретраев нет осознанно: его воркер
 * не идемпотентен (CalculationLog, уведомления) — см. комментарий в app.module.ts.
 */
const PARSE_JOB_OPTS = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 30_000 },
} as const;

@Injectable()
export class DocumentsService {
  private logger = new Logger(DocumentsService.name);

  constructor(
    @InjectRepository(Document) private repo: Repository<Document>,
    @InjectRepository(TelegramUser) private tgUserRepo: Repository<TelegramUser>,
    @InjectRepository(AiUsageLog) private aiUsageLogRepo: Repository<AiUsageLog>,
    @InjectQueue('document-parsing') private parsingQueue: Queue,
    @InjectQueue('document-processing') private processingQueue: Queue,
    private countriesService: CountriesService,
    private audit: PipelineAuditService,
    private regulatoryInterpreter: RegulatoryInterpreterService,
    private pipelineNotifier: PipelineNotifierService,
    private photoStorage: PhotoStorageService,
    private clientBalance: ClientBalanceService,
  ) {}

  /**
   * Lazy-load AI-выжимок разрешительных мер для всего документа одним запросом.
   * Собирает все RegulatoryItem'ы из resultData, прогоняет через interpreter,
   * возвращает Record<itemId, RegulatoryExplanation>. Для старых документов без
   * `regulatoryReport` в resultData отдаёт пустой объект.
   */
  async getRegulatoryExplanations(
    documentId: string,
    language?: string,
    actor?: Actor,
  ): Promise<Record<string, RegulatoryExplanation>> {
    const doc = await this.repo.findOne({ where: { id: documentId } });
    if (!doc) {
      throw new NotFoundException({ code: ErrorCode.DOCUMENT_NOT_FOUND, message: 'Document not found' });
    }
    if (actor) assertSameCompany(actor, doc.companyId);
    const items: RegulatoryItem[] = [];
    const seen = new Set<string>();
    for (const row of (doc.resultData ?? []) as Array<{ regulatoryReport?: RegulatoryReport | null }>) {
      const report = row.regulatoryReport;
      if (!report) continue;
      for (const item of RegulatoryRequirementsService.flattenReport(report)) {
        if (seen.has(item.id)) continue;
        seen.add(item.id);
        items.push(item);
      }
    }
    if (items.length === 0) return {};
    const result = await this.regulatoryInterpreter.explain(items, language ?? doc.language ?? 'ru');
    return Object.fromEntries(result.byId);
  }

  async create(dto: CreateDocumentDto): Promise<Document> {
    const doc = this.repo.create({
      telegramUserId: dto.telegramUserId,
      originalFileName: dto.originalFileName,
      columnMapping: dto.columnMapping,
      parsedData: dto.parsedData,
      rowCount: dto.parsedData.length,
      status: DocumentStatus.PENDING,
    });
    const saved = await this.repo.save(doc);
    await this.processingQueue.add('process-document', { documentId: saved.id });
    return saved;
  }

  async createFromFile(
    buffer: Buffer,
    fileName: string,
    source: { telegramUserId: string } | { uploadedByUserId: string; companyId: string | null },
    options: {
      freightCost?: number;
      freightCurrency?: FreightCurrency;
      /** Источник документа. По умолчанию self_service (текущее поведение). */
      documentSource?: DocumentSource;
      /** Запускать ли пайплайн сразу. По умолчанию true. Для managed-intake — false. */
      autoStart?: boolean;
    } = {},
  ): Promise<Document> {
    let language: string | null = null;
    let companyId: string | null = null;
    if ('telegramUserId' in source) {
      // Документ telegram-клиента наследует его компанию (NULL пока клиент не взят
      // менеджером — проставится при claim).
      const tgUser = await this.tgUserRepo.findOne({
        where: { id: source.telegramUserId },
        select: ['language', 'companyId'],
      });
      language = tgUser?.language ?? null;
      companyId = tgUser?.companyId ?? null;
    } else {
      companyId = source.companyId;
    }

    const freight = this.normalizeFreightOrThrow(options);
    const documentSource: DocumentSource = options.documentSource ?? 'self_service';
    const autoStart = options.autoStart ?? true;

    const doc = this.repo.create({
      ...('telegramUserId' in source
        ? { telegramUserId: source.telegramUserId }
        : { telegramUserId: null, uploadedByUserId: source.uploadedByUserId }),
      companyId,
      originalFileName: fileName,
      fileBuffer: buffer,
      language,
      source: documentSource,
      freightCost: freight.freightCost,
      freightCurrency: freight.freightCurrency,
      // managed-документ ждёт ручного запуска менеджером (INTAKE), self_service парсится сразу.
      status: autoStart ? DocumentStatus.PARSING : DocumentStatus.INTAKE,
    });

    const saved = await this.repo.save(doc);
    this.logger.log(
      `Document created: id=${saved.id}, file="${fileName}", size=${buffer.length} bytes, source=${documentSource}, autoStart=${autoStart}`,
    );
    if (autoStart) {
      await this.parsingQueue.add('parse-document', { documentId: saved.id }, PARSE_JOB_OPTS);
    }
    const { fileBuffer: _, ...result } = saved;
    return result as Document;
  }

  /**
   * Запуск пайплайна для INTAKE-документа (managed-флоу). Инициируется менеджером
   * из админки (POST /documents/:id/start) или из manager-bot. INTAKE → PARSING.
   */
  async startProcessing(id: string, actor?: Actor): Promise<Document> {
    this.logger.log(`Starting processing for intake document ${id}`);
    const doc = await this.findOne(id, actor); // 404, если документа нет или чужая компания
    // Атомарный переход INTAKE → PARSING: кнопка «🚀 Запустить» разослана broadcast'ом
    // всем менеджерам, и два одновременных клика проходили read-then-write проверку
    // оба — в очередь падало два parse-job'а (двойной расход Claude, интерлив записей).
    // UPDATE WHERE покрывает и неверный статус, и проигрыш конкурентной гонки.
    const res = await this.repo.update(
      { id, status: DocumentStatus.INTAKE },
      { status: DocumentStatus.PARSING },
    );
    if (!res.affected) {
      throw new BadRequestException({
        code: ErrorCode.INVALID_STATUS_FOR_START,
        message: 'Only intake documents can be started',
      });
    }
    await this.parsingQueue.add('parse-document', { documentId: id }, PARSE_JOB_OPTS);
    doc.status = DocumentStatus.PARSING;
    return doc;
  }

  async findAll(query: FindDocumentsQueryDto, actor: Actor): Promise<PaginatedResponse<Document>> {
    const scope = resolveCompanyScope(actor, query.companyId);
    const where: FindOptionsWhere<Document> = {};
    if (query.status) where.status = query.status;
    if (query.telegramUserId) where.telegramUserId = query.telegramUserId;
    if (scope !== undefined) where.companyId = scope;

    const [data, total] = await this.repo.findAndCount({
      select: [
        'id',
        'telegramUserId',
        'uploadedByUserId',
        'originalFileName',
        'status',
        'rowCount',
        'errorMessage',
        'rejectionReasons',
        'tokenUsage',
        'createdAt',
        'updatedAt',
      ],
      where,
      relations: ['telegramUser', 'uploadedBy'],
      order: { [query.sortBy]: query.sortOrder },
      skip: (query.page - 1) * query.limit,
      take: query.limit,
    });

    return paginate(data, total, query.page, query.limit);
  }

  /**
   * Быстрый пересчёт: обновляет countryOfOrigin (если передан) и ставит в очередь
   * recalculate-job. Calculator переиспользует сохранённый dutyInterpretation,
   * классификация+интерпретация не запускаются. Источник страны = 'manual', потому что
   * операция инициирована человеком.
   */
  async recalculate(
    id: string,
    dto: {
      countryOfOrigin?: string;
      freightCost?: number;
      freightCurrency?: FreightCurrency;
    },
    actor?: Actor,
  ): Promise<Document> {
    this.logger.log(
      `Recalculating document ${id} with country=${dto.countryOfOrigin ?? '(unchanged)'}, freight=${dto.freightCost ?? '(unchanged)'} ${dto.freightCurrency ?? ''}`,
    );
    const doc = await this.findOne(id, actor);

    // Пересчёт — операция над завершённым расчётом. REJECTED сюда сознательно не входит:
    // иначе отклонённый документ «воскресал» бы в PROCESSED одним запросом, минуя ревью.
    // FAILED разрешён для восстановления после упавшего recalculate (например, не было
    // курса валют) — resultData у такого документа сохранён.
    const recalculableStatuses: DocumentStatus[] = [
      DocumentStatus.PROCESSED,
      DocumentStatus.PROCESSED_WITH_ERRORS,
      DocumentStatus.CODE_REVIEW_REQUIRED,
      DocumentStatus.FAILED,
    ];
    if (!recalculableStatuses.includes(doc.status)) {
      throw new BadRequestException({
        code: ErrorCode.INVALID_STATUS_FOR_REPROCESS,
        message:
          'Only processed, processed_with_errors, code_review_required or failed documents can be recalculated',
      });
    }

    if (!doc.resultData || doc.resultData.length === 0) {
      throw new BadRequestException({
        code: ErrorCode.INVALID_STATUS_FOR_REPROCESS,
        message: 'Document has no result data to recalculate. Use /reprocess instead.',
      });
    }

    if (dto.countryOfOrigin !== undefined && dto.countryOfOrigin !== '') {
      const normalized = normalizeOksmtCode(dto.countryOfOrigin);
      // Сверяем со справочником — DTO проверяет только формат (1-3 цифры), но «999»
      // или прочий мусор прошёл бы. Лучше отдать 400 сразу, чем молча применить
      // несуществующий код и получить пустой результат фильтрации.
      const country = normalized ? await this.countriesService.findByCode(normalized) : null;
      if (!country) {
        throw new BadRequestException({
          code: ErrorCode.UNKNOWN_COUNTRY,
          message: `Unknown country code: ${dto.countryOfOrigin}`,
        });
      }
      doc.countryOfOrigin = country.code;
      doc.countryOriginSource = 'manual';
      doc.countryDetectionReason = null;
    }

    if (dto.freightCost !== undefined || dto.freightCurrency !== undefined) {
      const freight = this.normalizeFreightOrThrow({
        freightCost: dto.freightCost ?? doc.freightCost ?? undefined,
        freightCurrency: dto.freightCurrency ?? doc.freightCurrency ?? undefined,
      });
      doc.freightCost = freight.freightCost;
      doc.freightCurrency = freight.freightCurrency;
    }

    // Атомарный переход из исходного статуса — симметрично reprocess: двойной клик
    // «Пересчитать» ставил два job'а (второй прогон поверх результатов первого).
    const res = await this.repo.update(
      { id, status: doc.status },
      {
        status: DocumentStatus.PENDING,
        errorMessage: null,
        countryOfOrigin: doc.countryOfOrigin,
        countryOriginSource: doc.countryOriginSource,
        countryDetectionReason: doc.countryDetectionReason,
        freightCost: doc.freightCost,
        freightCurrency: doc.freightCurrency,
      },
    );
    if (!res.affected) {
      throw new BadRequestException({
        code: ErrorCode.INVALID_STATUS_FOR_REPROCESS,
        message: 'Document status changed concurrently — refresh and try again',
      });
    }
    await this.processingQueue.add('recalculate-document', { documentId: id });
    doc.status = DocumentStatus.PENDING;
    doc.errorMessage = null;
    return doc;
  }

  /** Тонкая обёртка вокруг чистого helper'а из common/freight: переводит
   *  InvalidFreightError в HTTP-ответ с кодом INVALID_FREIGHT. */
  private normalizeFreightOrThrow(options: {
    freightCost?: number | null;
    freightCurrency?: FreightCurrency | null;
  }): NormalizedFreight {
    try {
      return normalizeFreightInput(options);
    } catch (err) {
      if (err instanceof InvalidFreightError) {
        throw new BadRequestException({
          code: ErrorCode.INVALID_FREIGHT,
          message: err.message,
        });
      }
      throw err;
    }
  }

  async reprocess(id: string, actor?: Actor): Promise<Document> {
    this.logger.log(`Reprocessing document ${id}`);
    const doc = await this.findOne(id, actor);
    if (
      doc.status !== DocumentStatus.FAILED &&
      doc.status !== DocumentStatus.REQUIRES_REVIEW &&
      doc.status !== DocumentStatus.PROCESSED_WITH_ERRORS
    ) {
      throw new BadRequestException({
        code: ErrorCode.INVALID_STATUS_FOR_REPROCESS,
        message: 'Only failed, requires_review or processed_with_errors documents can be reprocessed',
      });
    }

    // Куда перезапускать: есть parsedData → processing; нет, но есть исходный файл →
    // парсинг; нет ни того ни другого — нечего переобрабатывать. Раньше последний
    // случай проваливался в processing с пустым parsedData, и документ выходил
    // «PROCESSED» с нулём строк — ошибка маскировалась под успех.
    const needsParsing = !doc.parsedData || doc.parsedData.length === 0;
    if (needsParsing) {
      const { hasBuffer } = await this.repo
        .createQueryBuilder('doc')
        .select('doc.file_buffer IS NOT NULL', 'hasBuffer')
        .where('doc.id = :id', { id })
        .getRawOne();
      if (!hasBuffer) {
        throw new BadRequestException({
          code: ErrorCode.INVALID_STATUS_FOR_REPROCESS,
          message: 'Document has neither parsed data nor the original file — nothing to reprocess',
        });
      }
    }

    // Атомарный переход из исходного статуса: двойной клик «Переобработать» проходил
    // read-then-write проверку дважды и ставил два job'а (двойной CalculationLog,
    // двойное уведомление, при двух репликах — интерлив параллельных прогонов).
    const targetStatus = needsParsing ? DocumentStatus.PARSING : DocumentStatus.PENDING;
    const res = await this.repo.update(
      { id, status: doc.status },
      { status: targetStatus, errorMessage: null, resultData: null },
    );
    if (!res.affected) {
      throw new BadRequestException({
        code: ErrorCode.INVALID_STATUS_FOR_REPROCESS,
        message: 'Document status changed concurrently — refresh and try again',
      });
    }

    if (needsParsing) {
      await this.parsingQueue.add('parse-document', { documentId: id }, PARSE_JOB_OPTS);
    } else {
      await this.processingQueue.add('process-document', { documentId: id });
    }
    doc.status = targetStatus;
    doc.errorMessage = null;
    doc.resultData = null;
    return doc;
  }

  async updateParsedData(
    id: string,
    dto: ReviewDocumentDto,
    meta: { userId?: string } = {},
    actor?: Actor,
  ): Promise<Document> {
    const doc = await this.findOne(id, actor);
    if (doc.status !== DocumentStatus.REQUIRES_REVIEW) {
      throw new BadRequestException({
        code: ErrorCode.INVALID_STATUS_FOR_REVIEW,
        message: 'Only requires_review documents can be edited',
      });
    }

    // Фото привязаны к индексам строк parsedData: если ревью изменило число строк
    // (удаление/добавление), индексы съехали и vision-retry подтверждал бы код по
    // чужой фотографии. Правки значений без изменения числа строк фото не трогают.
    if (dto.parsedData.length !== (doc.parsedData?.length ?? 0)) {
      await this.photoStorage.deleteForDocument(id);
    }

    doc.parsedData = dto.parsedData as unknown as Record<string, unknown>[];
    doc.rowCount = dto.parsedData.length;
    if (dto.currency) doc.currency = dto.currency;

    const saved = await this.repo.save(doc);
    void this.audit.recordDocumentVersion({
      documentId: id,
      reason: 'manual_edit',
      actorType: meta.userId ? 'user' : 'system',
      actorId: meta.userId ?? null,
      parsedData: saved.parsedData,
      currency: saved.currency,
      columnMapping: saved.columnMapping,
    });
    return saved;
  }

  async reject(id: string, dto: RejectDocumentDto, actor?: Actor): Promise<Document> {
    this.logger.log(`Rejecting document ${id}: ${dto.reason ?? '(no reason)'}`);
    const doc = await this.findOne(id, actor);

    if (
      doc.status !== DocumentStatus.REQUIRES_REVIEW &&
      doc.status !== DocumentStatus.CODE_REVIEW_REQUIRED
    ) {
      throw new BadRequestException({
        code: ErrorCode.INVALID_STATUS_FOR_REJECT,
        message: 'Only requires_review or code_review_required documents can be rejected',
      });
    }

    const operatorComment = dto.reason?.trim();
    const autoReasons = doc.rejectionReasons ?? [];
    const reasons = operatorComment
      ? [`Комментарий оператора: ${operatorComment}`, ...autoReasons]
      : autoReasons;

    if (doc.status === DocumentStatus.REQUIRES_REVIEW) {
      doc.status = DocumentStatus.FAILED;
      doc.errorMessage = operatorComment ?? null;
      if (reasons.length > 0) doc.rejectionReasons = reasons;
      const saved = await this.repo.save(doc);
      await this.pipelineNotifier.notify(saved);
      return saved;
    }

    doc.status = DocumentStatus.REJECTED;
    doc.rejectionReasons = reasons;
    const saved = await this.repo.save(doc);
    await this.pipelineNotifier.notify(saved);
    return saved;
  }

  async approve(id: string, actor?: Actor): Promise<Document> {
    this.logger.log(`Approving document ${id} as-is`);
    const doc = await this.findOne(id, actor);

    if (doc.status !== DocumentStatus.CODE_REVIEW_REQUIRED) {
      throw new BadRequestException({
        code: ErrorCode.INVALID_STATUS_FOR_APPROVE,
        message: 'Only code_review_required documents can be approved',
      });
    }

    doc.status = DocumentStatus.PROCESSED;
    doc.rejectionReasons = null;
    const saved = await this.repo.save(doc);
    // Одобрение из CODE_REVIEW_REQUIRED — оплачиваемый исход: списываем депозит
    // (идемпотентно — за этот документ ещё ничего не списывалось).
    await this.clientBalance.settle(saved);
    await this.pipelineNotifier.notify(saved);
    return saved;
  }

  async getTokenStats(model?: string, companyId?: string) {
    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const startOfWeek = new Date(startOfDay);
    startOfWeek.setDate(startOfWeek.getDate() - startOfWeek.getDay() + 1); // Monday
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    const [totalModels, todayModels, weekModels, monthModels, totalCount, todayCount, weekCount, monthCount] =
      await Promise.all([
        this.tokensByModel(undefined, model, companyId),
        this.tokensByModel(startOfDay, model, companyId),
        this.tokensByModel(startOfWeek, model, companyId),
        this.tokensByModel(startOfMonth, model, companyId),
        this.tokenDocCount(undefined, model, companyId),
        this.tokenDocCount(startOfDay, model, companyId),
        this.tokenDocCount(startOfWeek, model, companyId),
        this.tokenDocCount(startOfMonth, model, companyId),
      ]);

    let byUserQuery = `
      SELECT doc.telegram_user_id AS "telegramUserId",
        tu.username AS "username",
        tu.first_name AS "firstName",
        model_family(model.key) AS "model",
        COALESCE(SUM((model.value->>'inputTokens')::int), 0) AS "inputTokens",
        COALESCE(SUM((model.value->>'outputTokens')::int), 0) AS "outputTokens",
        COALESCE(SUM((model.value->>'cacheCreationTokens')::int), 0) AS "cacheCreationTokens",
        COALESCE(SUM((model.value->>'cacheReadTokens')::int), 0) AS "cacheReadTokens",
        COUNT(DISTINCT doc.id) AS "documentCount"
      FROM documents doc
      CROSS JOIN LATERAL jsonb_each(doc.token_usage) stage
      CROSS JOIN LATERAL jsonb_each(stage.value) model
      LEFT JOIN telegram_users tu ON tu.id = doc.telegram_user_id`;
    const byUserParams: unknown[] = [];
    const byUserConds: string[] = [];
    if (model) {
      byUserParams.push(model);
      byUserConds.push(`model_family(model.key) = $${byUserParams.length}`);
    }
    if (companyId) {
      byUserParams.push(companyId);
      byUserConds.push(`doc.company_id = $${byUserParams.length}`);
    }
    if (byUserConds.length) byUserQuery += ` WHERE ${byUserConds.join(' AND ')}`;
    byUserQuery += ` GROUP BY doc.telegram_user_id, tu.username, tu.first_name, model_family(model.key)`;

    const recentDocsQb = this.repo
      .createQueryBuilder('doc')
      .select(['doc.id', 'doc.originalFileName', 'doc.tokenUsage', 'doc.createdAt'])
      .leftJoin('doc.telegramUser', 'tu')
      .addSelect('tu.username')
      .where('doc.token_usage IS NOT NULL')
      .orderBy('doc.created_at', 'DESC')
      .limit(10);
    if (companyId) recentDocsQb.andWhere('doc.company_id = :companyId', { companyId });
    if (model) {
      recentDocsQb.andWhere(
        `EXISTS (
          SELECT 1 FROM jsonb_each(doc.token_usage) s, jsonb_each(s.value) m
          WHERE model_family(m.key) = :model
        )`,
        { model },
      );
    }

    const [byUser, recentDocs, availableModels, leadRows] = await Promise.all([
      this.repo.manager.query(byUserQuery, byUserParams),
      recentDocsQb.getMany(),
      this.availableModels(companyId),
      // Лиды — платформенный расход (company_id NULL): считаем только в общем разрезе.
      companyId ? Promise.resolve([]) : this.leadTokens(undefined, model),
    ]);

    return {
      availableModels,
      total: { models: this.toModelsMap(totalModels), documentCount: Number(totalCount?.count) || 0 },
      today: { models: this.toModelsMap(todayModels), documentCount: Number(todayCount?.count) || 0 },
      week: { models: this.toModelsMap(weekModels), documentCount: Number(weekCount?.count) || 0 },
      month: { models: this.toModelsMap(monthModels), documentCount: Number(monthCount?.count) || 0 },
      byUser: this.groupByUser(byUser),
      recentDocuments: recentDocs.map((doc) => ({
        id: doc.id,
        originalFileName: doc.originalFileName,
        tokenUsage: doc.tokenUsage,
        createdAt: doc.createdAt,
        telegramUsername: doc.telegramUser?.username ?? null,
      })),
      // Расход на автопоиск лидов (всего) для отдельной карточки на /ai-costs;
      // null в скоупе компании — это не её расход.
      leads: companyId ? null : this.toModelsMap(leadRows),
    };
  }

  async getMonthlyTotal(companyId?: string) {
    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);

    const [modelsRows, countRow, leadRows] = await Promise.all([
      this.tokensByModel(startOfMonth, undefined, companyId),
      this.tokenDocCount(startOfMonth, undefined, companyId),
      // Лиды — платформенный расход (company_id NULL): считаем только в общем разрезе.
      companyId ? Promise.resolve([]) : this.leadTokens(startOfMonth),
    ]);
    return {
      models: this.toModelsMap(modelsRows),
      documentCount: Number(countRow?.count) || 0,
      // Расход на автопоиск лидов за месяц для карточки на дашборде; null в скоупе компании.
      leads: companyId ? null : this.toModelsMap(leadRows),
    };
  }

  async getTokenStatsByDay(days: number, model?: string, companyId?: string) {
    const since = new Date();
    since.setDate(since.getDate() - days + 1);
    since.setHours(0, 0, 0, 0);

    let docQuery = `SELECT DATE(doc.created_at AT TIME ZONE 'UTC') AS "date", model_family(model.key) AS "model",
         COALESCE(SUM((model.value->>'inputTokens')::int), 0) AS "inputTokens",
         COALESCE(SUM((model.value->>'outputTokens')::int), 0) AS "outputTokens",
         COALESCE(SUM((model.value->>'cacheCreationTokens')::int), 0) AS "cacheCreationTokens",
         COALESCE(SUM((model.value->>'cacheReadTokens')::int), 0) AS "cacheReadTokens"
       FROM documents doc,
         jsonb_each(doc.token_usage) stage,
         jsonb_each(stage.value) model
       WHERE doc.created_at >= $1`;
    const docParams: unknown[] = [since];
    if (model) {
      docParams.push(model);
      docQuery += ` AND model_family(model.key) = $${docParams.length}`;
    }
    if (companyId) {
      docParams.push(companyId);
      docQuery += ` AND doc.company_id = $${docParams.length}`;
    }
    docQuery += ` GROUP BY "date", model_family(model.key) ORDER BY "date"`;

    let logQuery = `SELECT DATE(created_at AT TIME ZONE 'UTC') AS "date", model_family(model) AS "model",
         COALESCE(SUM(input_tokens), 0) AS "inputTokens",
         COALESCE(SUM(output_tokens), 0) AS "outputTokens",
         COALESCE(SUM(cache_creation_tokens), 0) AS "cacheCreationTokens",
         COALESCE(SUM(cache_read_tokens), 0) AS "cacheReadTokens"
       FROM ai_usage_log
       WHERE created_at >= $1`;
    const logParams: unknown[] = [since];
    if (model) {
      logParams.push(model);
      logQuery += ` AND model_family(model) = $${logParams.length}`;
    }
    if (companyId) {
      logParams.push(companyId);
      logQuery += ` AND company_id = $${logParams.length}`;
    }
    logQuery += ` GROUP BY "date", model_family(model) ORDER BY "date"`;

    const [docRows, logRows] = await Promise.all([
      this.repo.manager.query(docQuery, docParams),
      this.aiUsageLogRepo.manager.query(logQuery, logParams),
    ]);

    const dayMap = new Map<string, Record<string, { inputTokens: number; outputTokens: number; cacheCreationTokens: number; cacheReadTokens: number }>>();

    for (const row of [...docRows, ...logRows]) {
      const dateStr = typeof row.date === 'string' ? row.date.slice(0, 10) : (row.date as Date).toISOString().slice(0, 10);
      let models = dayMap.get(dateStr);
      if (!models) {
        models = {};
        dayMap.set(dateStr, models);
      }
      const existing = models[row.model];
      if (existing) {
        existing.inputTokens += Number(row.inputTokens) || 0;
        existing.outputTokens += Number(row.outputTokens) || 0;
        existing.cacheCreationTokens += Number(row.cacheCreationTokens) || 0;
        existing.cacheReadTokens += Number(row.cacheReadTokens) || 0;
      } else {
        models[row.model] = {
          inputTokens: Number(row.inputTokens) || 0,
          outputTokens: Number(row.outputTokens) || 0,
          cacheCreationTokens: Number(row.cacheCreationTokens) || 0,
          cacheReadTokens: Number(row.cacheReadTokens) || 0,
        };
      }
    }

    // Fill missing days using UTC dates to match SQL
    const result: Array<{ date: string; models: Record<string, { inputTokens: number; outputTokens: number; cacheCreationTokens: number; cacheReadTokens: number }> }> = [];
    const cursorMs = Date.UTC(since.getFullYear(), since.getMonth(), since.getDate());
    const todayMs = Date.UTC(new Date().getFullYear(), new Date().getMonth(), new Date().getDate());
    for (let ms = cursorMs; ms <= todayMs; ms += 86_400_000) {
      const dateStr = new Date(ms).toISOString().slice(0, 10);
      result.push({ date: dateStr, models: dayMap.get(dateStr) ?? {} });
    }

    return result;
  }

  async getStatusCounts(companyId?: string): Promise<Record<string, number>> {
    const qb = this.repo
      .createQueryBuilder('doc')
      .select('doc.status', 'status')
      .addSelect('COUNT(*)', 'count')
      .groupBy('doc.status');
    if (companyId) qb.andWhere('doc.company_id = :companyId', { companyId });
    const rows: Array<{ status: string; count: string }> = await qb.getRawMany();

    const counts: Record<string, number> = {};
    for (const row of rows) {
      counts[row.status] = Number(row.count);
    }
    return counts;
  }

  async findOne(id: string, actor?: Actor): Promise<Document> {
    const doc = await this.repo.findOne({
      where: { id },
      relations: ['telegramUser', 'uploadedBy'],
    });
    if (!doc)
      throw new NotFoundException({
        code: ErrorCode.DOCUMENT_NOT_FOUND,
        message: 'Document not found',
      });
    if (actor) assertSameCompany(actor, doc.companyId);
    return doc;
  }

  /**
   * Лёгкая проверка доступа к документу для под-ресурсов (diagnostics, calculation-logs,
   * excel), которые делегируют в другие сервисы по documentId. Бросает 404, если документа
   * нет или он принадлежит другой компании (для super_admin — только если не найден).
   */
  async assertAccess(id: string, actor: Actor): Promise<void> {
    const doc = await this.repo.findOne({ where: { id }, select: ['id', 'companyId'] });
    if (!doc)
      throw new NotFoundException({
        code: ErrorCode.DOCUMENT_NOT_FOUND,
        message: 'Document not found',
      });
    assertSameCompany(actor, doc.companyId);
  }

  /**
   * @deprecated Не используется с Фазы 3 «боты для компании»: компания клиента фиксируется при
   * register, документы наследуют её при создании (createFromFile), claim компанию больше не
   * переносит. Оставлен под отдельную задачу на удаление. См. docs/COMPANY_BOTS.md.
   *
   * Проставляет company_id только документам клиента без компании (историю уже привязанных к
   * другой компании не трогаем).
   */
  async assignCompanyToClientDocs(telegramUserId: string, companyId: string | null): Promise<void> {
    if (!companyId) return;
    await this.repo.update({ telegramUserId, companyId: IsNull() }, { companyId });
  }

  /**
   * Список семейств моделей для меню фильтра на /ai-costs. Намеренно НЕ зависит от
   * выбранного фильтра model (иначе при клике остальные кнопки пропадут — комментарий ниже
   * про дубли семейств), но скоупится по компании: admin видит только модели своей компании,
   * super_admin — все. ai_usage_log при заданной компании отфильтруется (company_id почти
   * всегда NULL), поэтому для admin меню формируется из его документов.
   */
  private async availableModels(companyId?: string): Promise<string[]> {
    const params: unknown[] = [];
    let docFilter = '';
    let logFilter = '';
    if (companyId) {
      params.push(companyId);
      docFilter = ` WHERE doc.company_id = $1`;
      logFilter = ` WHERE company_id = $1`;
    }
    const rows: Array<{ m: string }> = await this.repo.manager.query(
      `SELECT DISTINCT model_family(m) AS m FROM (
          SELECT model.key AS m
          FROM documents doc,
            jsonb_each(doc.token_usage) stage,
            jsonb_each(stage.value) model${docFilter}
          UNION
          SELECT model AS m FROM ai_usage_log${logFilter}
        ) all_models
        ORDER BY m`,
      params,
    );
    return rows.map((r) => r.m);
  }

  /** Aggregate per-model tokens from two sources: documents.token_usage (two-level
   *  JSONB { stage: { model: {...} } }) и ai_usage_log (translate/regulatory вне
   *  пайплайна). Объединяем UNION'ом — без log-источника сводные карточки /ai-costs
   *  недосчитывают расход вне документов (тот же UNION уже в getTokenStatsByDay). */
  private tokensByModel(since?: Date, model?: string, companyId?: string) {
    const params: unknown[] = [];
    const docConds: string[] = [];
    const logConds: string[] = [];
    if (since) {
      params.push(since);
      docConds.push(`doc.created_at >= $${params.length}`);
      logConds.push(`log.created_at >= $${params.length}`);
    }
    if (companyId) {
      params.push(companyId);
      docConds.push(`doc.company_id = $${params.length}`);
      logConds.push(`log.company_id = $${params.length}`);
    }
    const docWhere = docConds.length ? ` WHERE ${docConds.join(' AND ')}` : '';
    const logWhere = logConds.length ? ` WHERE ${logConds.join(' AND ')}` : '';
    let modelWhere = '';
    if (model) {
      params.push(model);
      modelWhere = ` WHERE model_family(t.m) = $${params.length}`;
    }
    const query = `
      SELECT model_family(t.m) AS "model",
        COALESCE(SUM(t."inputTokens"), 0) AS "inputTokens",
        COALESCE(SUM(t."outputTokens"), 0) AS "outputTokens",
        COALESCE(SUM(t."cacheCreationTokens"), 0) AS "cacheCreationTokens",
        COALESCE(SUM(t."cacheReadTokens"), 0) AS "cacheReadTokens"
      FROM (
        SELECT model.key AS m,
          (model.value->>'inputTokens')::int AS "inputTokens",
          (model.value->>'outputTokens')::int AS "outputTokens",
          (model.value->>'cacheCreationTokens')::int AS "cacheCreationTokens",
          (model.value->>'cacheReadTokens')::int AS "cacheReadTokens"
        FROM documents doc,
          jsonb_each(doc.token_usage) stage,
          jsonb_each(stage.value) model${docWhere}
        UNION ALL
        SELECT log.model AS m,
          log.input_tokens AS "inputTokens",
          log.output_tokens AS "outputTokens",
          log.cache_creation_tokens AS "cacheCreationTokens",
          log.cache_read_tokens AS "cacheReadTokens"
        FROM ai_usage_log log${logWhere}
      ) t${modelWhere}
      GROUP BY model_family(t.m)`;
    return this.repo.manager.query(query, params);
  }

  /** Расход на автопоиск лидов (purpose lead_discover|lead_enrich) из ai_usage_log,
   *  сгруппированный по семейству модели. Эти вызовы платформенные (company_id NULL) —
   *  метод НЕ скоупится по компании; вызывающий показывает их только в общем разрезе
   *  (без выбранной компании). model — опциональный фильтр семейства для согласования
   *  с фильтром моделей на /ai-costs. */
  private leadTokens(since?: Date, model?: string) {
    const params: unknown[] = [];
    const conds: string[] = [`purpose IN ('lead_discover', 'lead_enrich')`];
    if (since) {
      params.push(since);
      conds.push(`created_at >= $${params.length}`);
    }
    if (model) {
      params.push(model);
      conds.push(`model_family(model) = $${params.length}`);
    }
    const query = `
      SELECT model_family(model) AS "model",
        COALESCE(SUM(input_tokens), 0) AS "inputTokens",
        COALESCE(SUM(output_tokens), 0) AS "outputTokens",
        COALESCE(SUM(cache_creation_tokens), 0) AS "cacheCreationTokens",
        COALESCE(SUM(cache_read_tokens), 0) AS "cacheReadTokens"
      FROM ai_usage_log
      WHERE ${conds.join(' AND ')}
      GROUP BY model_family(model)`;
    return this.aiUsageLogRepo.manager.query(query, params);
  }

  private tokenDocCount(since?: Date, model?: string, companyId?: string) {
    const qb = this.repo
      .createQueryBuilder('doc')
      .select('COUNT(*)', 'count')
      .where('doc.token_usage IS NOT NULL');
    if (since) qb.andWhere('doc.created_at >= :since', { since });
    if (companyId) qb.andWhere('doc.company_id = :companyId', { companyId });
    if (model) {
      qb.andWhere(
        `EXISTS (
          SELECT 1 FROM jsonb_each(doc.token_usage) s, jsonb_each(s.value) m
          WHERE model_family(m.key) = :model
        )`,
        { model },
      );
    }
    return qb.getRawOne();
  }

  private toModelsMap(rows: Array<{ model: string; inputTokens: string; outputTokens: string; cacheCreationTokens?: string; cacheReadTokens?: string }>) {
    const map: Record<string, { inputTokens: number; outputTokens: number; cacheCreationTokens: number; cacheReadTokens: number }> = {};
    for (const row of rows) {
      map[row.model] = {
        inputTokens: Number(row.inputTokens) || 0,
        outputTokens: Number(row.outputTokens) || 0,
        cacheCreationTokens: Number(row.cacheCreationTokens) || 0,
        cacheReadTokens: Number(row.cacheReadTokens) || 0,
      };
    }
    return map;
  }

  /** Group flat byUser rows (one per user+model) into per-user objects with models map */
  private groupByUser(
    rows: Array<Record<string, string>>,
  ): Array<{
    telegramUserId: string | null;
    username: string | null;
    firstName: string | null;
    models: Record<string, { inputTokens: number; outputTokens: number; cacheCreationTokens: number; cacheReadTokens: number }>;
    documentCount: number;
  }> {
    const map = new Map<
      string,
      {
        telegramUserId: string | null;
        username: string | null;
        firstName: string | null;
        models: Record<string, { inputTokens: number; outputTokens: number; cacheCreationTokens: number; cacheReadTokens: number }>;
        documentCount: number;
      }
    >();

    for (const row of rows) {
      const key = row.telegramUserId ?? '__admin__';
      let entry = map.get(key);
      if (!entry) {
        entry = {
          telegramUserId: row.telegramUserId,
          username: row.username,
          firstName: row.firstName,
          models: {},
          documentCount: Number(row.documentCount) || 0,
        };
        map.set(key, entry);
      }
      entry.models[row.model] = {
        inputTokens: Number(row.inputTokens) || 0,
        outputTokens: Number(row.outputTokens) || 0,
        cacheCreationTokens: Number(row.cacheCreationTokens) || 0,
        cacheReadTokens: Number(row.cacheReadTokens) || 0,
      };
    }

    return [...map.values()].sort((a, b) => {
      const totalA = Object.values(a.models).reduce((s, m) => s + m.inputTokens + m.outputTokens, 0);
      const totalB = Object.values(b.models).reduce((s, m) => s + m.inputTokens + m.outputTokens, 0);
      return totalB - totalA;
    }).slice(0, 20);
  }
}
