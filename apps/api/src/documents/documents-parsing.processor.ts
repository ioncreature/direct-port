import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Job, Queue } from 'bullmq';
import { Repository } from 'typeorm';
import { AiParserService } from '../ai-parser/ai-parser.service';
import { ErrorCode } from '../common/error-codes';
import { classifyPipelineError, errMsg } from '../common/errors';
import { addStageUsage } from '../common/token-usage';
import { Document, DocumentStatus } from '../database/entities/document.entity';
import { PipelineAuditService } from '../pipeline-audit/pipeline-audit.service';
import { PipelineNotifierService } from './pipeline-notifier.service';
import { PhotoStorageService } from '../photo-storage/photo-storage.service';
import { startDocumentHeartbeat } from './status-heartbeat';

@Processor('document-parsing')
export class DocumentsParsingProcessor extends WorkerHost {
  private logger = new Logger(DocumentsParsingProcessor.name);

  constructor(
    @InjectRepository(Document) private repo: Repository<Document>,
    @InjectQueue('document-processing') private processingQueue: Queue,
    private aiParser: AiParserService,
    private audit: PipelineAuditService,
    private photoStorage: PhotoStorageService,
    private pipelineNotifier: PipelineNotifierService,
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

    // Guard от повторной доставки job (stalled-повтор после крэша/деплоя, двойная
    // постановка при гонке кликов): документ уже ушёл дальше по пайплайну или обработан
    // вручную — выходим, не трогая статус. Без guard'а повтор видел бы fileBuffer=null
    // и флипал уже распарсенный документ в FAILED с ложным уведомлением, пока
    // processing-воркер параллельно доводит его до PROCESSED.
    if (doc.status !== DocumentStatus.PARSING) {
      this.logger.warn(
        `Document ${documentId} is "${doc.status}", not "parsing" — skipping duplicate parse job`,
      );
      return;
    }

    if (!doc.fileBuffer) {
      this.logger.warn(`Document ${documentId} has no file buffer`);
      doc.status = DocumentStatus.FAILED;
      doc.errorMessage = 'File buffer is missing';
      const res = await this.repo.update(
        { id: documentId, status: DocumentStatus.PARSING },
        { status: DocumentStatus.FAILED, errorMessage: doc.errorMessage },
      );
      if (res.affected) await this.pipelineNotifier.notify(doc);
      return;
    }

    this.logger.log(`Document ${documentId}: file="${doc.originalFileName}", buffer=${doc.fileBuffer.length} bytes`);

    const attempt = (job.attemptsMade ?? 0) + 1;
    const stopHeartbeat = startDocumentHeartbeat(
      this.repo,
      documentId,
      DocumentStatus.PARSING,
      this.logger,
    );
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
        tokenUsage,
        countrySuggestion,
        photoBundle,
      } = parseResult;

      doc.parsedData = products;
      doc.currency = currency;
      doc.columnMapping = columnMapping;
      doc.rowCount = products.length;
      doc.tokenUsage = addStageUsage(doc.tokenUsage ?? {}, 'parser', tokenUsage);
      doc.fileBuffer = null;

      // Best-effort: фото — опциональный вход для vision-retry, ошибки не должны валить
      // парсинг. Вызываем и без фото: savePhotos чистит записи прошлого запуска, чьи
      // rowIndex после reparse указывали бы на другие строки.
      try {
        await this.photoStorage.savePhotos(
          documentId,
          photoBundle?.photos ?? [],
          photoBundle?.dataRowIndices ?? [],
        );
      } catch (err) {
        this.logger.warn(`Photo save failed for ${documentId}: ${errMsg(err)}`);
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

      // Финальный переход — условный UPDATE ... WHERE status='parsing': прежний
      // безусловный save был TOCTOU — stalled-дубль job'а, отставший от победителя,
      // перезаписывал parsedData/статус документа, уже ушедшего в processing (или
      // откатывал более поздний статус), и ставил второй processing-job (двойной
      // прогон, двойное уведомление). Проигравший дубль выходит молча, ничего не
      // записав и не поставив job.
      const parsePatch = {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- TypeORM QueryDeepPartialEntity rejects Record[] for jsonb column
        parsedData: doc.parsedData as any,
        currency: doc.currency,
        columnMapping: doc.columnMapping,
        rowCount: doc.rowCount,
        tokenUsage: doc.tokenUsage,
        fileBuffer: null,
        countryOfOrigin: doc.countryOfOrigin,
        countryOriginSource: doc.countryOriginSource,
        countryDetectionReason: doc.countryDetectionReason,
      };
      doc.status =
        feasibility === 'rejected'
          ? DocumentStatus.REJECTED
          : feasibility === 'ok'
            ? DocumentStatus.PENDING
            : DocumentStatus.REQUIRES_REVIEW;
      if (feasibility !== 'ok') {
        doc.rejectionReasons = rejectionReasons.length > 0 ? rejectionReasons : null;
      }
      const finalized = await this.repo.update(
        { id: documentId, status: DocumentStatus.PARSING },
        {
          ...parsePatch,
          status: doc.status,
          ...(feasibility !== 'ok' ? { rejectionReasons: doc.rejectionReasons } : {}),
        },
      );
      if (!finalized.affected) {
        this.logger.warn(
          `Document ${documentId} left "parsing" concurrently — discarding this parse run`,
        );
        return;
      }

      if (feasibility === 'rejected') {
        await this.pipelineNotifier.notify(doc);
        this.logger.log(`Document ${documentId} rejected: ${rejectionReasons.join('; ')}`);
      } else if (feasibility === 'ok') {
        await this.processingQueue.add('process-document', { documentId });
        // Промежуточный «классифицируем…» был self_service-пингом в tg-bot; менеджер
        // получает уведомление только на терминальных статусах — здесь не уведомляем.
        this.logger.log(
          `Document ${documentId} parsed: ${products.length} rows, sending to processing`,
        );
      } else {
        // feasibility === 'review'
        // managed: клиента не трогаем, но менеджеру нужно знать про необходимость ревью.
        // Для self_service — no-op внутри notify.
        await this.pipelineNotifier.notify(doc);
        this.logger.log(`Document ${documentId} parsed but needs review: ${rejectionReasons.join('; ')}`);
      }
    } catch (err) {
      void this.audit.failStageRun(stageRunId, err);
      // Не последняя попытка — оставляем статус PARSING и пробрасываем ошибку:
      // BullMQ ретраит по attempts/backoff из opts job'а (529/таймаут Anthropic —
      // транзиентные, FAILED на первой же попытке заставлял оператора жать
      // reprocess руками). Если ошибка прилетела после перехода в PENDING
      // (например, на постановке processing-job), guard статуса выше погасит повтор.
      const attemptsTotal = job.opts?.attempts ?? 1;
      if (attempt < attemptsTotal) {
        this.logger.warn(
          `Document ${documentId} parsing attempt ${attempt}/${attemptsTotal} failed, will retry: ${errMsg(err)}`,
        );
        throw err;
      }
      doc.status = DocumentStatus.FAILED;
      doc.errorMessage = errMsg(err) || 'Parsing failed';
      // Точечный update вместо save: fileBuffer сохраняем — это единственный источник
      // для повторного парсинга через POST /:id/reprocess (раньше транзиентная ошибка
      // Claude навсегда уничтожала исходный файл клиента), и не гоняем мегабайты
      // буфера в UPDATE. WHERE по статусу — не затираем документ, уже ушедший дальше
      // силами параллельного дубля job'а.
      const failed = await this.repo.update(
        { id: documentId, status: DocumentStatus.PARSING },
        {
          status: doc.status,
          errorMessage: doc.errorMessage,
        },
      );
      const errorCode = classifyPipelineError(err, ErrorCode.PARSING_FAILED);
      if (failed.affected) await this.pipelineNotifier.notify(doc);
      this.logger.error(
        `Document ${documentId} parsing failed [${errorCode}]: ${doc.errorMessage}`,
        err instanceof Error ? err.stack : err,
      );
    } finally {
      stopHeartbeat();
    }
  }
}
