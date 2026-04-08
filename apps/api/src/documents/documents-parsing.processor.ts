import { Processor, WorkerHost } from '@nestjs/bullmq';
import { InjectQueue } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Job, Queue } from 'bullmq';
import { Document, DocumentStatus } from '../database/entities/document.entity';
import { AiParserService } from '../ai-parser/ai-parser.service';

@Processor('document-parsing')
export class DocumentsParsingProcessor extends WorkerHost {
  private logger = new Logger(DocumentsParsingProcessor.name);

  constructor(
    @InjectRepository(Document) private repo: Repository<Document>,
    @InjectQueue('document-processing') private processingQueue: Queue,
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
      return;
    }

    try {
      const { products, currency, columnMapping, confident } =
        await this.aiParser.parse(doc.fileBuffer, doc.originalFileName);

      doc.parsedData = products;
      doc.currency = currency;
      doc.columnMapping = columnMapping;
      doc.rowCount = products.length;
      doc.fileBuffer = null;

      if (confident) {
        doc.status = DocumentStatus.PENDING;
        await this.repo.save(doc);
        await this.processingQueue.add('process-document', { documentId });
        this.logger.log(
          `Document ${documentId} parsed: ${products.length} rows, sending to processing`,
        );
      } else {
        doc.status = DocumentStatus.REQUIRES_REVIEW;
        await this.repo.save(doc);
        this.logger.log(
          `Document ${documentId} parsed but not confident, requires review`,
        );
      }
    } catch (err) {
      doc.status = DocumentStatus.FAILED;
      doc.errorMessage = err instanceof Error ? err.message : 'Parsing failed';
      doc.fileBuffer = null;
      await this.repo.save(doc);
      this.logger.error(`Document ${documentId} parsing failed`, err);
    }
  }
}
