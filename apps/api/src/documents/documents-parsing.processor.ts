import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Job, Queue } from 'bullmq';
import { Repository } from 'typeorm';
import { AiParserService } from '../ai-parser/ai-parser.service';
import { Document, DocumentStatus } from '../database/entities/document.entity';
import type { DocumentNotification } from './documents.processor';

@Processor('document-parsing')
export class DocumentsParsingProcessor extends WorkerHost {
  private logger = new Logger(DocumentsParsingProcessor.name);

  constructor(
    @InjectRepository(Document) private repo: Repository<Document>,
    @InjectQueue('document-processing') private processingQueue: Queue,
    @InjectQueue('document-notifications') private notificationQueue: Queue,
    private aiParser: AiParserService,
  ) {
    super();
  }

  async process(job: Job<{ documentId: string }>): Promise<void> {
    const { documentId } = job.data;
    this.logger.log(`Parsing document ${documentId}`);

    const doc = await this.repo
      .createQueryBuilder('doc')
      .select(['doc.id', 'doc.status', 'doc.originalFileName', 'doc.fileBuffer'])
      .leftJoinAndSelect('doc.telegramUser', 'tu')
      .where('doc.id = :id', { id: documentId })
      .getOne();

    if (!doc) {
      this.logger.warn(`Document ${documentId} not found`);
      return;
    }

    if (!doc.fileBuffer) {
      this.logger.warn(`Document ${documentId} has no file buffer`);
      doc.status = DocumentStatus.FAILED;
      doc.errorMessage = 'File buffer is missing';
      await this.repo.save(doc);
      await this.notify({ doc, status: 'failed', errorMessage: doc.errorMessage });
      return;
    }

    try {
      const { products, currency, columnMapping, feasibility, rejectionReasons } =
        await this.aiParser.parse(doc.fileBuffer, doc.originalFileName);

      doc.parsedData = products;
      doc.currency = currency;
      doc.columnMapping = columnMapping;
      doc.rowCount = products.length;
      doc.fileBuffer = null;

      if (feasibility === 'rejected') {
        doc.status = DocumentStatus.REJECTED;
        doc.rejectionReasons = rejectionReasons.length > 0 ? rejectionReasons : null;
        await this.repo.save(doc);
        await this.notify({ doc, status: 'rejected', rejectionReasons });
        this.logger.log(`Document ${documentId} rejected: ${rejectionReasons.join('; ')}`);
      } else if (feasibility === 'ok') {
        doc.status = DocumentStatus.PENDING;
        await this.repo.save(doc);
        await this.processingQueue.add('process-document', { documentId });
        this.logger.log(
          `Document ${documentId} parsed: ${products.length} rows, sending to processing`,
        );
      } else {
        // feasibility === 'review'
        doc.status = DocumentStatus.REQUIRES_REVIEW;
        doc.rejectionReasons = rejectionReasons.length > 0 ? rejectionReasons : null;
        await this.repo.save(doc);
        this.logger.log(`Document ${documentId} parsed but needs review: ${rejectionReasons.join('; ')}`);
      }
    } catch (err) {
      doc.status = DocumentStatus.FAILED;
      doc.errorMessage = err instanceof Error ? err.message : 'Parsing failed';
      doc.fileBuffer = null;
      await this.repo.save(doc);
      await this.notify({ doc, status: 'failed', errorMessage: doc.errorMessage ?? undefined });
      this.logger.error(`Document ${documentId} parsing failed`, err);
    }
  }

  private async notify(opts: {
    doc: Document;
    status: DocumentNotification['status'];
    errorMessage?: string;
    rejectionReasons?: string[];
  }): Promise<void> {
    const telegramId = opts.doc.telegramUser?.telegramId;
    if (!telegramId) return;

    const payload: DocumentNotification = {
      documentId: opts.doc.id,
      telegramUserId: telegramId,
      status: opts.status,
      errorMessage: opts.errorMessage,
      rejectionReasons: opts.rejectionReasons,
    };

    await this.notificationQueue.add('document-ready', payload).catch((err) => {
      this.logger.warn(`Failed to send notification for ${opts.doc.id}`, err);
    });
  }
}
