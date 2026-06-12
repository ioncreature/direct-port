import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, LessThan, Repository } from 'typeorm';
import { Document, DocumentStatus } from '../database/entities/document.entity';

/** Статусы, в которых документ живёт, только пока его двигает активный job. */
const ACTIVE_STATUSES = [
  DocumentStatus.PARSING,
  DocumentStatus.PENDING,
  DocumentStatus.PROCESSING,
] as const;

/**
 * Порог зависания. Обработка большого документа занимает минуты (бюджет ~15),
 * updatedAt обновляется при каждом сохранении статуса — час без единой записи
 * означает, что job мёртв (крэш пода посреди прогона, потерянный при недоступном
 * Redis job, дважды-stalled job, ушедший в failed без отметки в документе).
 */
const STUCK_AFTER_MS = 60 * 60_000;
const SWEEP_INTERVAL_MS = 10 * 60_000;
const FIRST_SWEEP_DELAY_MS = 60_000;

/**
 * Единственный механизм возврата документов, застрявших в активных статусах:
 * BullMQ с attempts по умолчанию не перезапускает упавшие job'ы, reprocess
 * принимает только терминальные статусы, и до этого watchdog'а документ,
 * чей воркер умер посреди PROCESSING, оставался в нём навсегда (видим только
 * вручную в БД). FAILED здесь — честный терминальный статус: оператор видит
 * документ в админке и перезапускает POST /:id/reprocess.
 */
@Injectable()
export class StuckDocumentsWatchdog implements OnModuleInit, OnModuleDestroy {
  private logger = new Logger(StuckDocumentsWatchdog.name);
  private timer: NodeJS.Timeout | null = null;
  private firstSweep: NodeJS.Timeout | null = null;

  constructor(@InjectRepository(Document) private repo: Repository<Document>) {}

  onModuleInit(): void {
    // Первый проход вскоре после старта: после крэша именно новый под должен
    // подобрать зависших, не дожидаясь полного интервала. unref — таймеры не
    // держат процесс при shutdown.
    this.firstSweep = setTimeout(() => void this.sweep(), FIRST_SWEEP_DELAY_MS);
    this.firstSweep.unref?.();
    this.timer = setInterval(() => void this.sweep(), SWEEP_INTERVAL_MS);
    this.timer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.firstSweep) clearTimeout(this.firstSweep);
    if (this.timer) clearInterval(this.timer);
  }

  /** Атомарный UPDATE — безопасен при нескольких репликах (вторая получит affected=0). */
  async sweep(): Promise<number> {
    try {
      const cutoff = new Date(Date.now() - STUCK_AFTER_MS);
      const res = await this.repo.update(
        { status: In([...ACTIVE_STATUSES]), updatedAt: LessThan(cutoff) },
        {
          status: DocumentStatus.FAILED,
          errorMessage:
            'Обработка прервана (перезапуск сервиса или потерянная задача очереди). ' +
            'Запустите повторную обработку.',
        },
      );
      const affected = res.affected ?? 0;
      if (affected > 0) {
        this.logger.warn(`Recovered ${affected} stuck document(s): active status > 60m → FAILED`);
      }
      return affected;
    } catch (err) {
      this.logger.error('Stuck documents sweep failed', err);
      return 0;
    }
  }
}
