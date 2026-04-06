import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosInstance } from 'axios';

@Injectable()
export class ApiClientService {
  private client: AxiosInstance;

  constructor(config: ConfigService) {
    this.client = axios.create({
      baseURL: config.get('API_BASE_URL', 'http://localhost:3001/api'),
      headers: {
        'X-Internal-Key': config.get('API_INTERNAL_KEY', ''),
      },
    });
  }

  async searchTnVed(query: string) {
    const { data } = await this.client.get('/tn-ved', { params: { search: query } });
    return data as TnVedResult[];
  }

  async logCalculation(payload: CalculationLogPayload) {
    await this.client.post('/calculation-logs', payload).catch(() => {});
  }
}

export interface TnVedResult {
  code: string;
  description: string;
  dutyRate: number;
  vatRate: number;
  exciseRate: number;
}

export interface CalculationLogPayload {
  telegramUserId: number;
  telegramUsername?: string;
  fileName?: string;
  itemsCount: number;
  resultSummary: Record<string, unknown>;
}
