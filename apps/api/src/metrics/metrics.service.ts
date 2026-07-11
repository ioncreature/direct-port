import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Queue } from 'bullmq';

const SAMPLE_INTERVAL_MS = 5 * 60_000;
const JOB_STATES = ['waiting', 'active', 'delayed', 'failed', 'completed', 'paused'] as const;

export interface QueueSnapshot {
  name: string;
  counts: Record<string, number>;
}

/**
 * Видимость очередей BullMQ. Прод раньше был «слепым»: ни метрик, ни bull-board, а
 * failed-job'ы доставочных/pipeline-очередей молча оседали в Redis (removeOnFail 30д) —
 * не доставленный клиенту Excel или потерянный менеджеру запрос никак не сигналили.
 * Здесь: снапшот счётчиков (эндпоинт /internal/metrics в Prometheus-формате) + периодический
 * сэмпл, который логирует warn при наличии failed-job'ов, чтобы их ловил лог-алертинг.
 */
@Injectable()
export class MetricsService implements OnModuleInit, OnModuleDestroy {
  private logger = new Logger(MetricsService.name);
  private timer: NodeJS.Timeout | null = null;
  private readonly queues: Queue[];

  constructor(
    @InjectQueue('document-parsing') parsing: Queue,
    @InjectQueue('document-processing') processing: Queue,
    @InjectQueue('manager-notifications') managerNotify: Queue,
    @InjectQueue('client-bot-outgoing') clientOut: Queue,
    @InjectQueue('lead-discovery') leadDiscovery: Queue,
    @InjectQueue('lead-enrichment') leadEnrichment: Queue,
  ) {
    this.queues = [parsing, processing, managerNotify, clientOut, leadDiscovery, leadEnrichment];
  }

  onModuleInit(): void {
    this.timer = setInterval(() => void this.sample(), SAMPLE_INTERVAL_MS);
    this.timer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async snapshot(): Promise<QueueSnapshot[]> {
    return Promise.all(
      this.queues.map(async (q) => ({
        name: q.name,
        counts: await q.getJobCounts(...JOB_STATES),
      })),
    );
  }

  /** Prometheus exposition text (gauge на очередь×состояние). */
  async toPrometheus(): Promise<string> {
    const snapshot = await this.snapshot();
    const lines = [
      '# HELP directport_queue_jobs Number of BullMQ jobs by queue and state',
      '# TYPE directport_queue_jobs gauge',
    ];
    for (const { name, counts } of snapshot) {
      for (const state of JOB_STATES) {
        lines.push(`directport_queue_jobs{queue="${name}",state="${state}"} ${counts[state] ?? 0}`);
      }
    }
    return lines.join('\n') + '\n';
  }

  private async sample(): Promise<void> {
    try {
      const snapshot = await this.snapshot();
      for (const { name, counts } of snapshot) {
        if ((counts.failed ?? 0) > 0) {
          this.logger.warn(
            `Queue "${name}": ${counts.failed} failed job(s), ${counts.waiting ?? 0} waiting`,
          );
        }
      }
    } catch (err) {
      this.logger.warn(`Metrics sample failed: ${String(err)}`);
    }
  }
}
