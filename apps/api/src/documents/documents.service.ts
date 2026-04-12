import { InjectQueue } from '@nestjs/bullmq';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Queue } from 'bullmq';
import { FindOptionsWhere, MoreThanOrEqual, Repository } from 'typeorm';
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

  async getTokenStats(): Promise<{
    total: { inputTokens: number; outputTokens: number; documentCount: number };
    today: { inputTokens: number; outputTokens: number; documentCount: number };
    week: { inputTokens: number; outputTokens: number; documentCount: number };
    month: { inputTokens: number; outputTokens: number; documentCount: number };
    byUser: Array<{
      telegramUserId: string | null;
      username: string | null;
      firstName: string | null;
      inputTokens: number;
      outputTokens: number;
      documentCount: number;
    }>;
    recentDocuments: Array<{
      id: string;
      originalFileName: string;
      inputTokens: number;
      outputTokens: number;
      createdAt: Date;
      telegramUsername: string | null;
    }>;
  }> {
    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const startOfWeek = new Date(startOfDay);
    startOfWeek.setDate(startOfWeek.getDate() - startOfWeek.getDay() + 1); // Monday
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    const periodQuery = (since: Date) =>
      this.repo
        .createQueryBuilder('doc')
        .select('COALESCE(SUM(doc.input_tokens), 0)', 'inputTokens')
        .addSelect('COALESCE(SUM(doc.output_tokens), 0)', 'outputTokens')
        .addSelect('COUNT(CASE WHEN doc.input_tokens > 0 OR doc.output_tokens > 0 THEN 1 END)', 'documentCount')
        .where('doc.created_at >= :since', { since })
        .getRawOne();

    const [total, today, week, month] = await Promise.all([
      this.repo
        .createQueryBuilder('doc')
        .select('COALESCE(SUM(doc.input_tokens), 0)', 'inputTokens')
        .addSelect('COALESCE(SUM(doc.output_tokens), 0)', 'outputTokens')
        .addSelect('COUNT(CASE WHEN doc.input_tokens > 0 OR doc.output_tokens > 0 THEN 1 END)', 'documentCount')
        .getRawOne(),
      periodQuery(startOfDay),
      periodQuery(startOfWeek),
      periodQuery(startOfMonth),
    ]);

    const parseRow = (row: Record<string, string>) => ({
      inputTokens: Number(row.inputTokens) || 0,
      outputTokens: Number(row.outputTokens) || 0,
      documentCount: Number(row.documentCount) || 0,
    });

    const byUser = await this.repo
      .createQueryBuilder('doc')
      .select('doc.telegram_user_id', 'telegramUserId')
      .addSelect('tu.username', 'username')
      .addSelect('tu.first_name', 'firstName')
      .addSelect('COALESCE(SUM(doc.input_tokens), 0)', 'inputTokens')
      .addSelect('COALESCE(SUM(doc.output_tokens), 0)', 'outputTokens')
      .addSelect('COUNT(*)', 'documentCount')
      .leftJoin('doc.telegramUser', 'tu')
      .where('doc.input_tokens > 0 OR doc.output_tokens > 0')
      .groupBy('doc.telegram_user_id')
      .addGroupBy('tu.username')
      .addGroupBy('tu.first_name')
      .orderBy('COALESCE(SUM(doc.input_tokens), 0) + COALESCE(SUM(doc.output_tokens), 0)', 'DESC')
      .limit(20)
      .getRawMany();

    const recentDocs = await this.repo
      .createQueryBuilder('doc')
      .select(['doc.id', 'doc.originalFileName', 'doc.inputTokens', 'doc.outputTokens', 'doc.createdAt'])
      .leftJoin('doc.telegramUser', 'tu')
      .addSelect('tu.username')
      .where('doc.input_tokens > 0 OR doc.output_tokens > 0')
      .orderBy('doc.created_at', 'DESC')
      .limit(10)
      .getMany();

    return {
      total: parseRow(total),
      today: parseRow(today),
      week: parseRow(week),
      month: parseRow(month),
      byUser: byUser.map((row: Record<string, string>) => ({
        telegramUserId: row.telegramUserId,
        username: row.username,
        firstName: row.firstName,
        inputTokens: Number(row.inputTokens) || 0,
        outputTokens: Number(row.outputTokens) || 0,
        documentCount: Number(row.documentCount) || 0,
      })),
      recentDocuments: recentDocs.map((doc) => ({
        id: doc.id,
        originalFileName: doc.originalFileName,
        inputTokens: doc.inputTokens,
        outputTokens: doc.outputTokens,
        createdAt: doc.createdAt,
        telegramUsername: doc.telegramUser?.username ?? null,
      })),
    };
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
}
