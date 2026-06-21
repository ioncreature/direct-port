import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { LeadDiscoveryService } from './lead-discovery.service';
import { LeadsService } from './leads.service';

interface DiscoveryJob {
  query: string;
  city?: string;
  maxResults?: number;
}

@Processor('lead-discovery')
export class LeadDiscoveryProcessor extends WorkerHost {
  private logger = new Logger(LeadDiscoveryProcessor.name);

  constructor(
    private readonly discovery: LeadDiscoveryService,
    private readonly leads: LeadsService,
  ) {
    super();
  }

  async process(job: Job<DiscoveryJob>): Promise<void> {
    const { query, city, maxResults } = job.data;
    this.logger.log(`Discovery start: «${query}»${city ? ` (${city})` : ''}`);

    const companies = await this.discovery.discover(query, { city, maxResults });
    if (companies.length === 0) {
      this.logger.warn(`Discovery «${query}»: кандидатов не найдено`);
      return;
    }

    const sourceDetail = (city ? `${query} · ${city}` : query).slice(0, 500);
    const { created, skipped } = await this.leads.saveDiscovered(companies, sourceDetail);
    this.logger.log(
      `Discovery «${query}»: найдено ${companies.length}, создано ${created}, дублей ${skipped}`,
    );
  }
}
