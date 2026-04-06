import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Job } from 'bullmq';
import { Document, DocumentStatus } from '../database/entities/document.entity';

@Processor('document-processing')
export class DocumentsProcessor extends WorkerHost {
  private logger = new Logger(DocumentsProcessor.name);

  constructor(
    @InjectRepository(Document) private repo: Repository<Document>,
  ) {
    super();
  }

  async process(job: Job<{ documentId: string }>): Promise<void> {
    const { documentId } = job.data;
    this.logger.log(`Processing document ${documentId}`);

    const doc = await this.repo.findOne({ where: { id: documentId } });
    if (!doc) {
      this.logger.warn(`Document ${documentId} not found`);
      return;
    }

    doc.status = DocumentStatus.PROCESSING;
    await this.repo.save(doc);

    // Stub: wait 5 seconds
    await new Promise((resolve) => setTimeout(resolve, 5000));

    doc.status = DocumentStatus.PROCESSED;
    doc.resultData = doc.parsedData;
    await this.repo.save(doc);

    this.logger.log(`Document ${documentId} processed`);
  }
}
