import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { InjectQueue } from '@nestjs/bullmq';
import { Repository } from 'typeorm';
import { Queue } from 'bullmq';
import { Document, DocumentStatus } from '../database/entities/document.entity';
import { CreateDocumentDto } from './dto/create-document.dto';

@Injectable()
export class DocumentsService {
  constructor(
    @InjectRepository(Document) private repo: Repository<Document>,
    @InjectQueue('document-processing') private queue: Queue,
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

  async findAll(): Promise<Document[]> {
    return this.repo.find({
      select: [
        'id', 'telegramUserId', 'originalFileName', 'status',
        'rowCount', 'errorMessage', 'createdAt', 'updatedAt',
      ],
      relations: ['telegramUser'],
      order: { createdAt: 'DESC' },
    });
  }

  async findOne(id: string): Promise<Document> {
    const doc = await this.repo.findOne({
      where: { id },
      relations: ['telegramUser'],
    });
    if (!doc) throw new NotFoundException('Document not found');
    return doc;
  }
}
