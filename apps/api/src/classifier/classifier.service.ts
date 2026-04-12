import {
  TksApiClient,
  calcProbability,
  type GoodsItem,
  type TnvedCode,
} from '@direct-port/tks-api';
import { Injectable, Logger } from '@nestjs/common';
import type { ProductNote } from '../common/product-notes';
import type { Dimension } from '../duty-interpreter/interfaces';

/**
 * Вход классификатора. Содержит минимум для поиска в TKS + опциональные
 * размеры (площадь/объём/штуки) и заметки от предыдущих этапов (парсер).
 */
export interface ProductRow {
  description: string;
  quantity: number;
  price: number;
  weight: number;
  dimensions?: Dimension[];
  notes?: ProductNote[];
}

export interface ClassifiedProduct extends ProductRow {
  tnVedCode: string;
  tnVedDescription: string;
  dutyRate: number;
  dutySign: string | null;
  dutyMin: number | null;
  dutyMinUnit: string | null;
  vatRate: number;
  exciseRate: number;
  matchConfidence: number;
  matched: boolean;
  tnvedRaw?: TnvedCode;
  /** Аккумулируемые заметки по товару — не теряются между этапами. */
  notes: ProductNote[];
}

const CONCURRENCY = 5;
const LOW_CONFIDENCE_THRESHOLD = 0.7;

@Injectable()
export class ClassifierService {
  private logger = new Logger(ClassifierService.name);

  constructor(private tksApi: TksApiClient) {}

  async classify(products: ProductRow[]): Promise<ClassifiedProduct[]> {
    const results: ClassifiedProduct[] = new Array(products.length);

    // Bounded concurrency: обрабатываем по CONCURRENCY продуктов параллельно
    for (let i = 0; i < products.length; i += CONCURRENCY) {
      const batch = products.slice(i, i + CONCURRENCY);
      const batchResults = await Promise.all(
        batch.map((product) =>
          this.classifyOne(product).catch((err) => {
            this.logger.warn(
              `Failed to classify "${product.description}": ${err instanceof Error ? err.message : err}`,
            );
            return this.unmatched(product);
          }),
        ),
      );
      for (let j = 0; j < batchResults.length; j++) {
        results[i + j] = batchResults[j];
      }
    }

    const matchedCount = results.filter((r) => r.matched).length;
    this.logger.log(`Classified ${results.length} products, matched: ${matchedCount}`);
    return results;
  }

  private async classifyOne(product: ProductRow): Promise<ClassifiedProduct> {
    const searchResult = await this.tksApi.searchGoodsGrouped(product.description);
    if (!searchResult.data.length) {
      return this.unmatched(product, 'TKS не вернул ни одного кандидата по описанию');
    }

    const best = this.selectBest(searchResult.data, searchResult.hm);
    if (!best) {
      return this.unmatched(product, 'Не удалось выбрать лучший кандидат из результата TKS');
    }

    const tnved = await this.tksApi.getTnvedCode(best.item.CODE);
    const rates = tnved.TNVED ?? {};

    const notes: ProductNote[] = [...(product.notes ?? [])];
    if (best.confidence < LOW_CONFIDENCE_THRESHOLD) {
      notes.push({
        stage: 'classify',
        severity: 'warning',
        field: 'code',
        message: `Классификатор TKS выбрал код ${tnved.CODE} с низкой уверенностью (${best.confidence.toFixed(2)}). Рекомендуется проверить код вручную.`,
      });
    }

    return {
      ...product,
      tnVedCode: tnved.CODE,
      tnVedDescription: tnved.KR_NAIM,
      dutyRate: rates.IMP ?? 0,
      dutySign: rates.IMPSIGN ?? null,
      dutyMin: rates.IMP2 ?? null,
      dutyMinUnit: rates.IMPEDI2 ?? null,
      vatRate: rates.NDS ?? 20,
      exciseRate: rates.AKC ?? 0,
      matchConfidence: best.confidence,
      matched: true,
      tnvedRaw: tnved,
      notes,
    };
  }

  private selectBest(
    items: GoodsItem[],
    total: number,
  ): { item: GoodsItem; confidence: number } | null {
    if (!items.length) return null;

    let bestItem = items[0];
    let bestConfidence = calcProbability(items[0], total);

    for (let i = 1; i < items.length; i++) {
      const conf = calcProbability(items[i], total);
      if (conf > bestConfidence) {
        bestItem = items[i];
        bestConfidence = conf;
      }
    }

    return { item: bestItem, confidence: bestConfidence };
  }

  private unmatched(product: ProductRow, reason = 'Код ТН ВЭД не определён'): ClassifiedProduct {
    const notes: ProductNote[] = [
      ...(product.notes ?? []),
      {
        stage: 'classify',
        severity: 'blocker',
        field: 'code',
        message: `${reason}. Без кода ТН ВЭД расчёт пошлины и НДС невозможен.`,
      },
    ];
    return {
      ...product,
      tnVedCode: '',
      tnVedDescription: 'Не найден',
      dutyRate: 0,
      dutySign: null,
      dutyMin: null,
      dutyMinUnit: null,
      vatRate: 20,
      exciseRate: 0,
      matchConfidence: 0,
      matched: false,
      notes,
    };
  }
}
