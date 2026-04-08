import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { InjectQueue } from '@nestjs/bullmq';
import { FindOptionsWhere, Repository } from 'typeorm';
import { Queue } from 'bullmq';
import { Document, DocumentStatus } from '../database/entities/document.entity';
import { CreateDocumentDto } from './dto/create-document.dto';
import { FindDocumentsQueryDto } from './dto/find-documents-query.dto';
import { ReviewDocumentDto } from './dto/review-document.dto';
import { RejectDocumentDto } from './dto/reject-document.dto';
import { paginate, PaginatedResponse } from '../common/interfaces/paginated';

@Injectable()
export class DocumentsService {
  constructor(
    @InjectRepository(Document) private repo: Repository<Document>,
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
    const doc = this.repo.create({
      ...('telegramUserId' in source
        ? { telegramUserId: source.telegramUserId }
        : { telegramUserId: null, uploadedByUserId: source.uploadedByUserId }),
      originalFileName: fileName,
      fileBuffer: buffer,
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
        'id', 'telegramUserId', 'uploadedByUserId', 'originalFileName', 'status',
        'rowCount', 'errorMessage', 'createdAt', 'updatedAt',
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
      throw new BadRequestException('Only failed or requires_review documents can be reprocessed');
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
      throw new BadRequestException('Only requires_review documents can be edited');
    }

    doc.parsedData = dto.parsedData as unknown as Record<string, unknown>[];
    doc.rowCount = dto.parsedData.length;
    if (dto.currency) doc.currency = dto.currency;

    return this.repo.save(doc);
  }

  async reject(id: string, dto: RejectDocumentDto): Promise<Document> {
    const doc = await this.findOne(id);
    if (doc.status !== DocumentStatus.REQUIRES_REVIEW) {
      throw new BadRequestException('Only requires_review documents can be rejected');
    }

    doc.status = DocumentStatus.FAILED;
    doc.errorMessage = dto.reason;
    return this.repo.save(doc);
  }

  async findOne(id: string): Promise<Document> {
    const doc = await this.repo.findOne({
      where: { id },
      relations: ['telegramUser', 'uploadedBy'],
    });
    if (!doc) throw new NotFoundException('Document not found');
    return doc;
  }
}
