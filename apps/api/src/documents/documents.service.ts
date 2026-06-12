import { InjectQueue } from '@nestjs/bullmq';
import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Queue } from 'bullmq';
import { FindOptionsWhere, Repository } from 'typeorm';
import { ErrorCode } from '../common/error-codes';
import {
  InvalidFreightError,
  normalizeFreightInput,
  type NormalizedFreight,
} from '../common/freight';
import { paginate, PaginatedResponse } from '../common/interfaces/paginated';
import { normalizeOksmtCode } from '../common/oksmt';
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
import { buildDocumentNotificationPayload, type DocumentNotification } from './notification';
import { ManagerNotifyService } from '../conversations/manager-notify.service';
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
    @InjectQueue('document-notifications') private notificationsQueue: Queue,
    private countriesService: CountriesService,
    private audit: PipelineAuditService,
    private regulatoryInterpreter: RegulatoryInterpreterService,
    private managerNotify: ManagerNotifyService,
    private photoStorage: PhotoStorageService,
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
  ): Promise<Record<string, RegulatoryExplanation>> {
    const doc = await this.repo.findOne({ where: { id: documentId } });
    if (!doc) {
      throw new NotFoundException({ code: ErrorCode.DOCUMENT_NOT_FOUND, message: 'Document not found' });
    }
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
    source: { telegramUserId: string } | { uploadedByUserId: string },
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
    if ('telegramUserId' in source) {
      const tgUser = await this.tgUserRepo.findOne({
        where: { id: source.telegramUserId },
        select: ['language'],
      });
      language = tgUser?.language ?? null;
    }

    const freight = this.normalizeFreightOrThrow(options);
    const documentSource: DocumentSource = options.documentSource ?? 'self_service';
    const autoStart = options.autoStart ?? true;

    const doc = this.repo.create({
      ...('telegramUserId' in source
        ? { telegramUserId: source.telegramUserId }
        : { telegramUserId: null, uploadedByUserId: source.uploadedByUserId }),
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
  async startProcessing(id: string): Promise<Document> {
    this.logger.log(`Starting processing for intake document ${id}`);
    const doc = await this.findOne(id); // 404, если документа нет
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

  async findAll(query: FindDocumentsQueryDto): Promise<PaginatedResponse<Document>> {
    const where: FindOptionsWhere<Document> = {};
    if (query.status) where.status = query.status;
    if (query.telegramUserId) where.telegramUserId = query.telegramUserId;

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
  ): Promise<Document> {
    this.logger.log(
      `Recalculating document ${id} with country=${dto.countryOfOrigin ?? '(unchanged)'}, freight=${dto.freightCost ?? '(unchanged)'} ${dto.freightCurrency ?? ''}`,
    );
    const doc = await this.findOne(id);

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

  async reprocess(id: string): Promise<Document> {
    this.logger.log(`Reprocessing document ${id}`);
    const doc = await this.findOne(id);
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
  ): Promise<Document> {
    const doc = await this.findOne(id);
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

  async reject(id: string, dto: RejectDocumentDto): Promise<Document> {
    this.logger.log(`Rejecting document ${id}: ${dto.reason ?? '(no reason)'}`);
    const doc = await this.findOne(id);

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
      await this.enqueueNotification(saved, 'failed', {
        errorMessage: operatorComment,
      });
      return saved;
    }

    doc.status = DocumentStatus.REJECTED;
    doc.rejectionReasons = reasons;
    const saved = await this.repo.save(doc);
    await this.enqueueNotification(saved, 'rejected', { rejectionReasons: reasons });
    return saved;
  }

  async approve(id: string): Promise<Document> {
    this.logger.log(`Approving document ${id} as-is`);
    const doc = await this.findOne(id);

    if (doc.status !== DocumentStatus.CODE_REVIEW_REQUIRED) {
      throw new BadRequestException({
        code: ErrorCode.INVALID_STATUS_FOR_APPROVE,
        message: 'Only code_review_required documents can be approved',
      });
    }

    doc.status = DocumentStatus.PROCESSED;
    doc.rejectionReasons = null;
    const saved = await this.repo.save(doc);
    await this.enqueueNotification(saved, 'processed');
    return saved;
  }

  private async enqueueNotification(
    doc: Document,
    status: DocumentNotification['status'],
    extra: { errorMessage?: string; rejectionReasons?: string[] } = {},
  ): Promise<void> {
    // managed-документ: уведомляем менеджера, а не клиента.
    if (doc.source === 'managed') {
      await this.managerNotify.notifyDocumentEvent(doc);
      return;
    }
    const payload = buildDocumentNotificationPayload(doc, status, extra);
    if (!payload) return;

    await this.notificationsQueue
      .add('document-ready', payload)
      .catch((err) => this.logger.warn(`Failed to enqueue notification for ${doc.id}`, err));
  }

  async getTokenStats(model?: string) {
    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const startOfWeek = new Date(startOfDay);
    startOfWeek.setDate(startOfWeek.getDate() - startOfWeek.getDay() + 1); // Monday
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    const [totalModels, todayModels, weekModels, monthModels, totalCount, todayCount, weekCount, monthCount] =
      await Promise.all([
        this.tokensByModel(undefined, model),
        this.tokensByModel(startOfDay, model),
        this.tokensByModel(startOfWeek, model),
        this.tokensByModel(startOfMonth, model),
        this.tokenDocCount(undefined, model),
        this.tokenDocCount(startOfDay, model),
        this.tokenDocCount(startOfWeek, model),
        this.tokenDocCount(startOfMonth, model),
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
    if (model) {
      byUserParams.push(model);
      byUserQuery += ` WHERE model_family(model.key) = $1`;
    }
    byUserQuery += ` GROUP BY doc.telegram_user_id, tu.username, tu.first_name, model_family(model.key)`;

    const recentDocsQb = this.repo
      .createQueryBuilder('doc')
      .select(['doc.id', 'doc.originalFileName', 'doc.tokenUsage', 'doc.createdAt'])
      .leftJoin('doc.telegramUser', 'tu')
      .addSelect('tu.username')
      .where('doc.token_usage IS NOT NULL')
      .orderBy('doc.created_at', 'DESC')
      .limit(10);
    if (model) {
      recentDocsQb.andWhere(
        `EXISTS (
          SELECT 1 FROM jsonb_each(doc.token_usage) s, jsonb_each(s.value) m
          WHERE model_family(m.key) = :model
        )`,
        { model },
      );
    }

    const [byUser, recentDocs, availableModels] = await Promise.all([
      this.repo.manager.query(byUserQuery, byUserParams),
      recentDocsQb.getMany(),
      // availableModels — это меню выбора в UI, и его список НЕ должен зависеть
      // от текущего фильтра: иначе при клике на семейство остальные табы
      // пропадут. Группируем по семейству, чтобы устаревшие записи (те, что
      // не попали под NormalizeModelFamilies — например translate, успевший
      // записать полный version ID между миграцией и передеплоем API) не
      // дублировали кнопки «Claude Haiku» и «Claude Opus» в фильтре.
      this.repo.manager
        .query(`
          SELECT DISTINCT model_family(m) AS m FROM (
            SELECT model.key AS m
            FROM documents doc,
              jsonb_each(doc.token_usage) stage,
              jsonb_each(stage.value) model
            UNION
            SELECT model AS m FROM ai_usage_log
          ) all_models
          ORDER BY m
        `)
        .then((rows: Array<{ m: string }>) => rows.map((r) => r.m)),
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
    };
  }

  async getMonthlyTotal() {
    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);

    const [modelsRows, countRow] = await Promise.all([
      this.tokensByModel(startOfMonth),
      this.tokenDocCount(startOfMonth),
    ]);
    return { models: this.toModelsMap(modelsRows), documentCount: Number(countRow?.count) || 0 };
  }

  async getTokenStatsByDay(days: number, model?: string) {
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
      docQuery += ` AND model_family(model.key) = $2`;
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
      logQuery += ` AND model_family(model) = $2`;
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

  async getStatusCounts(): Promise<Record<string, number>> {
    const rows: Array<{ status: string; count: string }> = await this.repo
      .createQueryBuilder('doc')
      .select('doc.status', 'status')
      .addSelect('COUNT(*)', 'count')
      .groupBy('doc.status')
      .getRawMany();

    const counts: Record<string, number> = {};
    for (const row of rows) {
      counts[row.status] = Number(row.count);
    }
    return counts;
  }

  async findOne(id: string): Promise<Document> {
    const doc = await this.repo.findOne({
      where: { id },
      relations: ['telegramUser', 'uploadedBy'],
    });
    if (!doc)
      throw new NotFoundException({
        code: ErrorCode.DOCUMENT_NOT_FOUND,
        message: 'Document not found',
      });
    return doc;
  }

  /** Aggregate per-model tokens from two sources: documents.token_usage (two-level
   *  JSONB { stage: { model: {...} } }) и ai_usage_log (translate/regulatory вне
   *  пайплайна). Объединяем UNION'ом — без log-источника сводные карточки /ai-costs
   *  недосчитывают расход вне документов (тот же UNION уже в getTokenStatsByDay). */
  private tokensByModel(since?: Date, model?: string) {
    const params: unknown[] = [];
    let sinceRef = '';
    if (since) {
      params.push(since);
      sinceRef = `$${params.length}`;
    }
    const docWhere = sinceRef ? ` WHERE doc.created_at >= ${sinceRef}` : '';
    const logWhere = sinceRef ? ` WHERE log.created_at >= ${sinceRef}` : '';
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

  private tokenDocCount(since?: Date, model?: string) {
    const qb = this.repo
      .createQueryBuilder('doc')
      .select('COUNT(*)', 'count')
      .where('doc.token_usage IS NOT NULL');
    if (since) qb.andWhere('doc.created_at >= :since', { since });
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
