import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Job, Queue } from 'bullmq';
import { Repository } from 'typeorm';
import { AiParserService } from '../ai-parser/ai-parser.service';
import { ErrorCode } from '../common/error-codes';
import { classifyPipelineError, errMsg } from '../common/errors';
import { localizeRejectionReasonsForUser } from '../common/rejection-reasons';
import { addStageUsage } from '../common/token-usage';
import { Document, DocumentStatus } from '../database/entities/document.entity';
import { PipelineAuditService } from '../pipeline-audit/pipeline-audit.service';
import { buildDocumentNotificationPayload, type DocumentNotification } from './notification';
import { ManagerNotifyService } from '../conversations/manager-notify.service';
import { PhotoStorageService } from '../photo-storage/photo-storage.service';

@Processor('document-parsing')
export class DocumentsParsingProcessor extends WorkerHost {
  private logger = new Logger(DocumentsParsingProcessor.name);

  constructor(
    @InjectRepository(Document) private repo: Repository<Document>,
    @InjectQueue('document-processing') private processingQueue: Queue,
    @InjectQueue('document-notifications') private notificationQueue: Queue,
    private aiParser: AiParserService,
    private audit: PipelineAuditService,
    private photoStorage: PhotoStorageService,
    private managerNotify: ManagerNotifyService,
  ) {
    super();
  }

  async process(job: Job<{ documentId: string }>): Promise<void> {
    const { documentId } = job.data;
    this.logger.log(`Parsing document ${documentId}`);

    const doc = await this.repo
      .createQueryBuilder('doc')
      .select(['doc.id', 'doc.status', 'doc.source', 'doc.originalFileName', 'doc.fileBuffer', 'doc.language', 'doc.createdAt'])
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
      await this.notify({ doc, status: 'failed', errorCode: ErrorCode.MISSING_FILE_BUFFER });
      return;
    }

    this.logger.log(`Document ${documentId}: file="${doc.originalFileName}", buffer=${doc.fileBuffer.length} bytes`);

    const attempt = (job.attemptsMade ?? 0) + 1;
    const stageRunId = await this.audit.startStageRun({
      documentId,
      stage: 'parse',
      attempt,
      metadata: {
        fileName: doc.originalFileName,
        fileSize: doc.fileBuffer.length,
        jobId: job.id,
      },
    });
    const auditCtx = { documentId, stageRunId };

    try {
      const parseResult = await this.aiParser.parse(
        doc.fileBuffer,
        doc.originalFileName,
        auditCtx,
      );
      const {
        products,
        currency,
        columnMapping,
        feasibility,
        rejectionReasons,
        rejectionReasonsData,
        tokenUsage,
        countrySuggestion,
        photoBundle,
      } = parseResult;
      const rejectionReasonsLocalized = localizeRejectionReasonsForUser(
        rejectionReasonsData,
        doc.language ?? doc.telegramUser?.language,
      );

      doc.parsedData = products;
      doc.currency = currency;
      doc.columnMapping = columnMapping;
      doc.rowCount = products.length;
      doc.tokenUsage = addStageUsage(doc.tokenUsage ?? {}, 'parser', tokenUsage);
      doc.fileBuffer = null;

      // Best-effort: фото — опциональный вход для vision-retry, ошибки не должны валить парсинг.
      if (photoBundle) {
        try {
          await this.photoStorage.savePhotos(
            documentId,
            photoBundle.photos,
            photoBundle.dataRowIndices,
          );
        } catch (err) {
          this.logger.warn(`Photo save failed for ${documentId}: ${errMsg(err)}`);
        }
      }

      // Manual-значение не затираем при reparse.
      if (doc.countryOriginSource !== 'manual' && countrySuggestion) {
        doc.countryOfOrigin = countrySuggestion.code;
        doc.countryOriginSource = countrySuggestion.source;
        doc.countryDetectionReason = countrySuggestion.reason;
      }

      void this.audit.completeStageRun(stageRunId, {
        output: {
          productCount: products.length,
          currency,
          columnMapping,
          feasibility,
          rejectionReasons,
          countrySuggestion,
        },
        tokenUsage,
        partial: feasibility !== 'ok',
      });
      void this.audit.recordDocumentVersion({
        documentId,
        reason: 'ai_parse',
        actorType: 'system',
        parsedData: products as unknown as Record<string, unknown>[],
        currency,
        columnMapping,
      });

      if (feasibility === 'rejected') {
        doc.status = DocumentStatus.REJECTED;
        doc.rejectionReasons = rejectionReasons.length > 0 ? rejectionReasons : null;
        await this.repo.save(doc);
        await this.notify({ doc, status: 'rejected', rejectionReasons, rejectionReasonsLocalized });
        this.logger.log(`Document ${documentId} rejected: ${rejectionReasons.join('; ')}`);
      } else if (feasibility === 'ok') {
        doc.status = DocumentStatus.PENDING;
        await this.repo.save(doc);
        await this.processingQueue.add('process-document', { documentId });
        await this.notify({
          doc,
          status: 'stage_classifying',
          itemCount: products.length,
        });
        this.logger.log(
          `Document ${documentId} parsed: ${products.length} rows, sending to processing`,
        );
      } else {
        // feasibility === 'review'
        doc.status = DocumentStatus.REQUIRES_REVIEW;
        doc.rejectionReasons = rejectionReasons.length > 0 ? rejectionReasons : null;
        await this.repo.save(doc);
        // managed: клиента не трогаем, но менеджеру нужно знать про необходимость ревью.
        if (doc.source === 'managed') {
          await this.managerNotify.notifyDocumentEvent(doc);
        }
        this.logger.log(`Document ${documentId} parsed but needs review: ${rejectionReasons.join('; ')}`);
      }
    } catch (err) {
      void this.audit.failStageRun(stageRunId, err);
      doc.status = DocumentStatus.FAILED;
      doc.errorMessage = errMsg(err) || 'Parsing failed';
      doc.fileBuffer = null;
      await this.repo.save(doc);
      const errorCode = classifyPipelineError(err, ErrorCode.PARSING_FAILED);
      await this.notify({ doc, status: 'failed', errorCode });
      this.logger.error(
        `Document ${documentId} parsing failed [${errorCode}]: ${doc.errorMessage}`,
        err instanceof Error ? err.stack : err,
      );
    }
  }

  private async notify(opts: {
    doc: Document;
    status: DocumentNotification['status'];
    errorMessage?: string;
    errorCode?: string;
    rejectionReasons?: string[];
    rejectionReasonsLocalized?: string[];
    itemCount?: number;
  }): Promise<void> {
    // managed-документ: уведомляем менеджера, а не клиента.
    if (opts.doc.source === 'managed') {
      await this.managerNotify.notifyDocumentEvent(opts.doc);
      return;
    }
    const payload = buildDocumentNotificationPayload(opts.doc, opts.status, {
      errorMessage: opts.errorMessage,
      errorCode: opts.errorCode,
      rejectionReasons: opts.rejectionReasons,
      rejectionReasonsLocalized: opts.rejectionReasonsLocalized,
      itemCount: opts.itemCount,
    });
    if (!payload) return;

    await this.notificationQueue.add('document-ready', payload).catch((err) => {
      this.logger.warn(`Failed to send notification for ${opts.doc.id}`, err);
    });
  }
}
