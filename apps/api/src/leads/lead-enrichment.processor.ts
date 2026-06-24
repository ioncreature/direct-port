import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Job } from 'bullmq';
import { Repository } from 'typeorm';
import { errMsg } from '../common/errors';
import { Lead, LeadStatus } from '../database/entities/lead.entity';
import { LeadEnrichmentService } from './lead-enrichment.service';

/** Статусы, которые уже двинул менеджер — их обогащение не сбрасывает. */
const MANAGER_OWNED: ReadonlySet<LeadStatus> = new Set([
  LeadStatus.IN_PROGRESS,
  LeadStatus.CONTACTED,
  LeadStatus.QUALIFIED,
  LeadStatus.REJECTED,
]);

@Processor('lead-enrichment')
export class LeadEnrichmentProcessor extends WorkerHost {
  private logger = new Logger(LeadEnrichmentProcessor.name);

  constructor(
    @InjectRepository(Lead) private readonly repo: Repository<Lead>,
    private readonly enrichment: LeadEnrichmentService,
  ) {
    super();
  }

  async process(job: Job<{ leadId: string }>): Promise<void> {
    const lead = await this.repo.findOne({ where: { id: job.data.leadId } });
    if (!lead) {
      this.logger.warn(`Lead ${job.data.leadId} not found — skip enrichment`);
      return;
    }

    const managerOwned = MANAGER_OWNED.has(lead.status);
    if (!managerOwned) {
      await this.repo.update(lead.id, { status: LeadStatus.ENRICHING });
    }

    try {
      const e = await this.enrichment.enrich(lead);
      // Omit relation convertedClient — это не колонка, её тип ломает сигнатуру repo.update().
      const patch: Partial<Omit<Lead, 'convertedClient'>> = {
        phones: e.phones,
        emails: e.emails,
        services: e.services,
        doesImport: e.doesImport,
        importDirections: e.importDirections,
        relevanceScore: e.relevanceScore,
        relevanceReason: e.relevanceReason,
        errorMessage: null,
      };
      // ИНН/город дополняем, но не затираем уже известные (из импорта реестра).
      if (e.inn) patch.inn = e.inn;
      if (e.city) patch.city = e.city;
      if (!managerOwned) patch.status = LeadStatus.ENRICHED;
      await this.repo.update(lead.id, patch);
      this.logger.log(`Lead ${lead.id} enriched: score=${e.relevanceScore ?? 'n/a'}`);
    } catch (err) {
      const message = errMsg(err) || 'enrichment failed';
      // Статус менеджерского лида не роняем в FAILED — только пишем ошибку.
      await this.repo.update(
        lead.id,
        managerOwned
          ? { errorMessage: message }
          : { status: LeadStatus.FAILED, errorMessage: message },
      );
      this.logger.warn(`Lead ${lead.id} enrichment failed: ${message}`);
    }
  }
}
