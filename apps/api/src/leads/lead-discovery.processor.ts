import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { errMsg } from '../common/errors';
import { LeadDiscoveryService } from './lead-discovery.service';
import { LeadsService } from './leads.service';

interface DiscoveryJob {
  searchId?: string;
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
    const { searchId, query, city, maxResults } = job.data;
    this.logger.log(`Discovery start: «${query}»${city ? ` (${city})` : ''}`);

    try {
      const companies = await this.discovery.discover(query, { city, maxResults });
      let created = 0;
      let skipped = 0;
      if (companies.length > 0) {
        const sourceDetail = (city ? `${query} · ${city}` : query).slice(0, 500);
        ({ created, skipped } = await this.leads.saveDiscovered(companies, sourceDetail));
      }
      if (searchId) {
        await this.leads.completeSearch(searchId, { found: companies.length, created, skipped });
      }
      this.logger.log(
        `Discovery «${query}»: найдено ${companies.length}, создано ${created}, дублей ${skipped}`,
      );
    } catch (err) {
      if (searchId) await this.leads.failSearch(searchId, errMsg(err));
      throw err; // пусть BullMQ тоже зафиксирует падение джобы
    }
  }
}
