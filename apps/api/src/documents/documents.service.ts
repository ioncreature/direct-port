import { InjectQueue } from '@nestjs/bullmq';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Queue } from 'bullmq';
import { FindOptionsWhere, Repository } from 'typeorm';
import { ErrorCode } from '../common/error-codes';
import { paginate, PaginatedResponse } from '../common/interfaces/paginated';
import { Document, DocumentStatus } from '../database/entities/document.entity';
import { TelegramUser } from '../database/entities/telegram-user.entity';
import { CreateDocumentDto } from './dto/create-document.dto';
import { FindDocumentsQueryDto } from './dto/find-documents-query.dto';
import { RejectDocumentDto } from './dto/reject-document.dto';
import { ReviewDocumentDto } from './dto/review-document.dto';

@Injectable()
export class DocumentsService {
  constructor(
    @InjectRepository(Document) private repo: Repository<Document>,
    @InjectRepository(TelegramUser) private tgUserRepo: Repository<TelegramUser>,
    @InjectQueue('document-parsing') private parsingQueue: Queue,
    @InjectQueue('document-processing') private processingQueue: Queue,
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

  async reprocess(id: string): Promise<Document> {
    const doc = await this.findOne(id);
    if (doc.status !== DocumentStatus.FAILED && doc.status !== DocumentStatus.REQUIRES_REVIEW) {
      throw new BadRequestException({
        code: ErrorCode.INVALID_STATUS_FOR_REPROCESS,
        message: 'Only failed or requires_review documents can be reprocessed',
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
    const doc = await this.findOne(id);
    if (doc.status !== DocumentStatus.REQUIRES_REVIEW) {
      throw new BadRequestException({
        code: ErrorCode.INVALID_STATUS_FOR_REJECT,
        message: 'Only requires_review documents can be rejected',
      });
    }

    doc.status = DocumentStatus.FAILED;
    doc.errorMessage = dto.reason;
    return this.repo.save(doc);
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

    const byUserQb = this.repo.manager
      .createQueryBuilder()
      .select('doc.telegram_user_id', 'telegramUserId')
      .addSelect('tu.username', 'username')
      .addSelect('tu.first_name', 'firstName')
      .addSelect('model.key', 'model')
      .addSelect("COALESCE(SUM((model.value->>'inputTokens')::int), 0)", 'inputTokens')
      .addSelect("COALESCE(SUM((model.value->>'outputTokens')::int), 0)", 'outputTokens')
      .addSelect('COUNT(DISTINCT doc.id)', 'documentCount')
      .from('documents', 'doc')
      .innerJoin('jsonb_each(doc.token_usage)', 'stage', '1=1')
      .innerJoin('jsonb_each(stage.value)', 'model', '1=1')
      .leftJoin('telegram_users', 'tu', 'tu.id = doc.telegram_user_id')
      .groupBy('doc.telegram_user_id')
      .addGroupBy('tu.username')
      .addGroupBy('tu.first_name')
      .addGroupBy('model.key');
    if (model) byUserQb.where('model.key = :model', { model });

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
      byUserQb.getRawMany(),
      recentDocsQb.getMany(),
      model
        ? Promise.resolve([model])
        : this.repo.manager
            .createQueryBuilder()
            .select('DISTINCT model.key', 'model')
            .from('documents', 'doc')
            .innerJoin('jsonb_each(doc.token_usage)', 'stage', '1=1')
            .innerJoin('jsonb_each(stage.value)', 'model', '1=1')
            .getRawMany()
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
    const qb = this.repo.manager
      .createQueryBuilder()
      .select('model.key', 'model')
      .addSelect("COALESCE(SUM((model.value->>'inputTokens')::int), 0)", 'inputTokens')
      .addSelect("COALESCE(SUM((model.value->>'outputTokens')::int), 0)", 'outputTokens')
      .from('documents', 'doc')
      .innerJoin('jsonb_each(doc.token_usage)', 'stage', '1=1')
      .innerJoin('jsonb_each(stage.value)', 'model', '1=1')
      .groupBy('model.key');
    if (since) qb.where('doc.created_at >= :since', { since });
    if (model) qb.andWhere('model.key = :model', { model });
    return qb.getRawMany();
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

  private toModelsMap(rows: Array<{ model: string; inputTokens: string; outputTokens: string }>) {
    const map: Record<string, { inputTokens: number; outputTokens: number }> = {};
    for (const row of rows) {
      map[row.model] = {
        inputTokens: Number(row.inputTokens) || 0,
        outputTokens: Number(row.outputTokens) || 0,
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
    models: Record<string, { inputTokens: number; outputTokens: number }>;
    documentCount: number;
  }> {
    const map = new Map<
      string,
      {
        telegramUserId: string | null;
        username: string | null;
        firstName: string | null;
        models: Record<string, { inputTokens: number; outputTokens: number }>;
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
      };
    }

    return [...map.values()].sort((a, b) => {
      const totalA = Object.values(a.models).reduce((s, m) => s + m.inputTokens + m.outputTokens, 0);
      const totalB = Object.values(b.models).reduce((s, m) => s + m.inputTokens + m.outputTokens, 0);
      return totalB - totalA;
    }).slice(0, 20);
  }
}
