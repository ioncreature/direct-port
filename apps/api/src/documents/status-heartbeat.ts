import type { Logger } from '@nestjs/common';
import type { Repository } from 'typeorm';
import type { Document, DocumentStatus } from '../database/entities/document.entity';

const HEARTBEAT_INTERVAL_MS = 5 * 60_000;

/**
 * Периодический «пульс» живого прогона: обновляет updated_at документа, пока воркер
 * работает. StuckDocumentsWatchdog считает зависшим всё, что провело в активном
 * статусе >60 мин без единой записи, — а между стартовым и финальным save воркеров
 * промежуточных записей в documents нет, поэтому легитимно долгий документ (сотни
 * позиций, ретраи Anthropic/TKS) помечался FAILED заживо, и оператор мог запустить
 * второй прогон параллельно ещё живому первому.
 *
 * WHERE по статусу — пульс не «оживляет» документ, уже переведённый вотчдогом или
 * оператором в другое состояние. Возвращает stop-функцию; вызывать её в finally.
 */
export function startDocumentHeartbeat(
  repo: Repository<Document>,
  documentId: string,
  status: DocumentStatus,
  logger: Logger,
  intervalMs: number = HEARTBEAT_INTERVAL_MS,
): () => void {
  const timer = setInterval(() => {
    repo
      .query(`UPDATE documents SET updated_at = now() WHERE id = $1 AND status = $2`, [
        documentId,
        status,
      ])
      .catch((err: unknown) => {
        logger.warn(`Heartbeat update failed for document ${documentId}: ${String(err)}`);
      });
  }, intervalMs);
  timer.unref?.();
  return () => clearInterval(timer);
}
