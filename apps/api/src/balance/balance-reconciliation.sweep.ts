import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ClientBalanceService } from './client-balance.service';

const SWEEP_INTERVAL_MS = 30 * 60_000;
const FIRST_SWEEP_DELAY_MS = 3 * 60_000;

/**
 * Планировщик фоновой сверки списаний (ClientBalanceService.reconcileSettledDocuments).
 * settle и releaseReservation осознанно best-effort («никогда не бросают»), поэтому
 * транзиентный сбой БД в момент списания раньше оставлял PROCESSED-документ
 * недосписанным навсегда — тихая утечка выручки без какого-либо следа, кроме
 * error-лога. Sweep добирает такие расхождения, пока документ в 7-дневном окне.
 * Паттерн повторяет StuckDocumentsWatchdog (unref-таймеры, ранний первый проход).
 */
@Injectable()
export class BalanceReconciliationSweep implements OnModuleInit, OnModuleDestroy {
  private logger = new Logger(BalanceReconciliationSweep.name);
  private timer: NodeJS.Timeout | null = null;
  private firstSweep: NodeJS.Timeout | null = null;

  constructor(private clientBalance: ClientBalanceService) {}

  onModuleInit(): void {
    this.firstSweep = setTimeout(() => void this.sweep(), FIRST_SWEEP_DELAY_MS);
    this.firstSweep.unref?.();
    this.timer = setInterval(() => void this.sweep(), SWEEP_INTERVAL_MS);
    this.timer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.firstSweep) clearTimeout(this.firstSweep);
    if (this.timer) clearInterval(this.timer);
  }

  async sweep(): Promise<void> {
    try {
      const fixed = await this.clientBalance.reconcileSettledDocuments();
      if (fixed > 0) {
        this.logger.warn(`Balance reconciliation sweep fixed ${fixed} document charge(s)`);
      }
      // Возврат удержанных позиций по терминальным FAILED/REJECTED, чей резерв не откатился
      // штатно (крэш пода посреди прогона, транзиентный сбой БД на releaseReservation).
      const refunded = await this.clientBalance.reconcileAbandonedReservations();
      if (refunded > 0) {
        this.logger.warn(`Balance reconciliation sweep refunded ${refunded} abandoned reservation(s)`);
      }
    } catch (err) {
      this.logger.error('Balance reconciliation sweep failed', err);
    }
  }
}
