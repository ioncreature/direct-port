import { Injectable, Logger } from '@nestjs/common';
import { ApiClientService, TnVedResult } from '../api-client/api-client.service';

export interface ClassifiedProduct {
  description: string;
  quantity: number;
  price: number;
  weight: number;
  tnVedCode: string;
  tnVedDescription: string;
  dutyRate: number;
  vatRate: number;
  exciseRate: number;
  matched: boolean;
}

@Injectable()
export class ClassifierService {
  private logger = new Logger(ClassifierService.name);

  constructor(private apiClient: ApiClientService) {}

  async classify(products: { description: string; quantity: number; price: number; weight: number }[]): Promise<ClassifiedProduct[]> {
    const results: ClassifiedProduct[] = [];

    for (const product of products) {
      const matches = await this.apiClient.searchTnVed(product.description);
      const best = this.selectBestMatch(matches);

      results.push({
        ...product,
        tnVedCode: best?.code || '',
        tnVedDescription: best?.description || 'Не найден',
        dutyRate: best?.dutyRate || 0,
        vatRate: best?.vatRate || 20,
        exciseRate: best?.exciseRate || 0,
        matched: !!best,
      });
    }

    this.logger.log(`Classified ${results.length} products, matched: ${results.filter((r) => r.matched).length}`);
    return results;
  }

  private selectBestMatch(matches: TnVedResult[]): TnVedResult | null {
    return matches.length > 0 ? matches[0] : null;
  }
}
