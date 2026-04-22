import { InjectQueue } from '@nestjs/bullmq';
import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Queue } from 'bullmq';
import { FindOptionsWhere, Repository } from 'typeorm';
import { ErrorCode } from '../common/error-codes';
import { paginate, PaginatedResponse } from '../common/interfaces/paginated';
import { normalizeOksmtCode } from '../common/oksmt';
import { AiUsageLog } from '../database/entities/ai-usage-log.entity';
import { Document, DocumentStatus } from '../database/entities/document.entity';
import { TelegramUser } from '../database/entities/telegram-user.entity';
import { CreateDocumentDto } from './dto/create-document.dto';
import { FindDocumentsQueryDto } from './dto/find-documents-query.dto';
import { RejectDocumentDto } from './dto/reject-document.dto';
import { ReviewDocumentDto } from './dto/review-document.dto';
import { buildDocumentNotificationPayload, type DocumentNotification } from './notification';

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
  ) {}

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
  ): Promise<Document> {
    let language: string | null = null;
    if ('telegramUserId' in source) {
      const tgUser = await this.tgUserRepo.findOne({
        where: { id: source.telegramUserId },
        select: ['language'],
      });
      language = tgUser?.language ?? null;
    }

    const doc = this.repo.create({
      ...('telegramUserId' in source
        ? { telegramUserId: source.telegramUserId }
        : { telegramUserId: null, uploadedByUserId: source.uploadedByUserId }),
      originalFileName: fileName,
      fileBuffer: buffer,
      language,
      status: DocumentStatus.PARSING,
    });

    const saved = await this.repo.save(doc);
    this.logger.log(`Document created: id=${saved.id}, file="${fileName}", size=${buffer.length} bytes, source=${JSON.stringify(source)}`);
    await this.parsingQueue.add('parse-document', { documentId: saved.id });
    const { fileBuffer: _, ...result } = saved;
    return result as Document;
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
  async recalculate(id: string, dto: { countryOfOrigin?: string }): Promise<Document> {
    this.logger.log(`Recalculating document ${id} with country=${dto.countryOfOrigin ?? '(unchanged)'}`);
    const doc = await this.findOne(id);

    if (!doc.resultData || doc.resultData.length === 0) {
      throw new BadRequestException({
        code: ErrorCode.INVALID_STATUS_FOR_REPROCESS,
        message: 'Document has no result data to recalculate. Use /reprocess instead.',
      });
    }

    const normalized = normalizeOksmtCode(dto.countryOfOrigin);
    if (normalized) {
      doc.countryOfOrigin = normalized;
      doc.countryOriginSource = 'manual';
      doc.countryDetectionReason = null;
    }

    doc.status = DocumentStatus.PENDING;
    doc.errorMessage = null;
    const saved = await this.repo.save(doc);
    await this.processingQueue.add('recalculate-document', { documentId: saved.id });
    return saved;
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

    doc.errorMessage = null;
    doc.resultData = null;

    if (!doc.parsedData || doc.parsedData.length === 0) {
      const { hasBuffer } = await this.repo
        .createQueryBuilder('doc')
        .select('doc.file_buffer IS NOT NULL', 'hasBuffer')
        .where('doc.id = :id', { id })
        .getRawOne();

      if (hasBuffer) {
        doc.status = DocumentStatus.PARSING;
        await this.repo.save(doc);
        await this.parsingQueue.add('parse-document', { documentId: id });
        return doc;
      }
    }

    doc.status = DocumentStatus.PENDING;
    const saved = await this.repo.save(doc);
    await this.processingQueue.add('process-document', { documentId: saved.id });
    return saved;
  }

  async updateParsedData(id: string, dto: ReviewDocumentDto): Promise<Document> {
    const doc = await this.findOne(id);
    if (doc.status !== DocumentStatus.REQUIRES_REVIEW) {
      throw new BadRequestException({
        code: ErrorCode.INVALID_STATUS_FOR_REVIEW,
        message: 'Only requires_review documents can be edited',
      });
    }

    doc.parsedData = dto.parsedData as unknown as Record<string, unknown>[];
    doc.rowCount = dto.parsedData.length;
    if (dto.currency) doc.currency = dto.currency;

    return this.repo.save(doc);
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
        model.key AS "model",
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
      byUserQuery += ` WHERE model.key = $1`;
    }
    byUserQuery += ` GROUP BY doc.telegram_user_id, tu.username, tu.first_name, model.key`;

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
        `EXISTS (SELECT 1 FROM jsonb_each(doc.token_usage) s WHERE s.value ? :model)`,
        { model },
      );
    }

    const [byUser, recentDocs, availableModels] = await Promise.all([
      this.repo.manager.query(byUserQuery, byUserParams),
      recentDocsQb.getMany(),
      model
        ? Promise.resolve([model])
        : this.repo.manager
            .query(`
              SELECT DISTINCT model.key AS "model"
              FROM documents doc,
                jsonb_each(doc.token_usage) stage,
                jsonb_each(stage.value) model
            `)
            .then((rows: Array<{ model: string }>) => rows.map((r) => r.model).sort()),
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

    let docQuery = `SELECT DATE(doc.created_at AT TIME ZONE 'UTC') AS "date", model.key AS "model",
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
      docQuery += ` AND model.key = $2`;
    }
    docQuery += ` GROUP BY "date", model.key ORDER BY "date"`;

    let logQuery = `SELECT DATE(created_at AT TIME ZONE 'UTC') AS "date", model AS "model",
         COALESCE(SUM(input_tokens), 0) AS "inputTokens",
         COALESCE(SUM(output_tokens), 0) AS "outputTokens",
         COALESCE(SUM(cache_creation_tokens), 0) AS "cacheCreationTokens",
         COALESCE(SUM(cache_read_tokens), 0) AS "cacheReadTokens"
       FROM ai_usage_log
       WHERE created_at >= $1`;
    const logParams: unknown[] = [since];
    if (model) {
      logParams.push(model);
      logQuery += ` AND model = $2`;
    }
    logQuery += ` GROUP BY "date", model ORDER BY "date"`;

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

  /** Aggregate per-model tokens from two-level JSONB: { stage: { model: { in, out } } } */
  private tokensByModel(since?: Date, model?: string) {
    let query = `
      SELECT model.key AS "model",
        COALESCE(SUM((model.value->>'inputTokens')::int), 0) AS "inputTokens",
        COALESCE(SUM((model.value->>'outputTokens')::int), 0) AS "outputTokens",
        COALESCE(SUM((model.value->>'cacheCreationTokens')::int), 0) AS "cacheCreationTokens",
        COALESCE(SUM((model.value->>'cacheReadTokens')::int), 0) AS "cacheReadTokens"
      FROM documents doc,
        jsonb_each(doc.token_usage) stage,
        jsonb_each(stage.value) model`;
    const params: unknown[] = [];
    const conditions: string[] = [];
    if (since) {
      params.push(since);
      conditions.push(`doc.created_at >= $${params.length}`);
    }
    if (model) {
      params.push(model);
      conditions.push(`model.key = $${params.length}`);
    }
    if (conditions.length) query += ' WHERE ' + conditions.join(' AND ');
    query += ' GROUP BY model.key';
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
        `EXISTS (SELECT 1 FROM jsonb_each(doc.token_usage) s WHERE s.value ? :model)`,
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
