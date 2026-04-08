import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { InjectQueue } from '@nestjs/bullmq';
import { FindOptionsWhere, Repository } from 'typeorm';
import { Queue } from 'bullmq';
import { Document, DocumentStatus } from '../database/entities/document.entity';
import { CreateDocumentDto } from './dto/create-document.dto';
import { FindDocumentsQueryDto } from './dto/find-documents-query.dto';
import { AiParserService } from '../ai-parser/ai-parser.service';
import { paginate, PaginatedResponse } from '../common/interfaces/paginated';

@Injectable()
export class DocumentsService {
  constructor(
    @InjectRepository(Document) private repo: Repository<Document>,
    @InjectQueue('document-processing') private queue: Queue,
    private aiParser: AiParserService,
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
    await this.queue.add('process-document', { documentId: saved.id });
    return saved;
  }

  async createFromFile(
    buffer: Buffer,
    fileName: string,
    source: { telegramUserId: string } | { uploadedByUserId: string },
  ): Promise<Document> {
    const { products, currency, columnMapping, confident } = await this.aiParser.parse(buffer, fileName);
    const status = confident ? DocumentStatus.PENDING : DocumentStatus.REQUIRES_REVIEW;

    const doc = this.repo.create({
      ...('telegramUserId' in source
        ? { telegramUserId: source.telegramUserId }
        : { telegramUserId: null, uploadedByUserId: source.uploadedByUserId }),
      originalFileName: fileName,
      columnMapping,
      parsedData: products,
      currency,
      rowCount: products.length,
      status,
    });

    const saved = await this.repo.save(doc);
    if (confident) {
      await this.queue.add('process-document', { documentId: saved.id });
    }
    return saved;
  }

  async findAll(query: FindDocumentsQueryDto): Promise<PaginatedResponse<Document>> {
    const where: FindOptionsWhere<Document> = {};
    if (query.status) where.status = query.status;

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

  async findOne(id: string): Promise<Document> {
    const doc = await this.repo.findOne({
      where: { id },
      relations: ['telegramUser', 'uploadedBy'],
    });
    if (!doc) throw new NotFoundException('Document not found');
    return doc;
  }
}
