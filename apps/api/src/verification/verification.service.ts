import Anthropic from '@anthropic-ai/sdk';
import { TksApiClient } from '@direct-port/tks-api';
import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import type { ClassifiedProduct } from '../classifier/classifier.service';
import { extractClaudeText, parseClaudeJson } from '../common/claude';
import type { ProductNote } from '../common/product-notes';

export interface VerifiedProduct extends ClassifiedProduct {
  /** Claude подтвердил код */
  verified: boolean;
  /** Код предложенный Claude (если отличается) */
  suggestedCode: string | null;
  /** Комментарий Claude */
  verificationComment: string;
}

interface VerificationResult {
  index: number;
  correct: boolean;
  suggestedCode: string | null;
  comment: string;
  confidence: number;
}

function verifyNote(severity: ProductNote['severity'], message: string): ProductNote {
  return { stage: 'verify', severity, field: 'code', message };
}

const SYSTEM_PROMPT = `Ты — эксперт по таможенной классификации товаров по ТН ВЭД (Товарная номенклатура внешнеэкономической деятельности ЕАЭС).

Твоя задача — верифицировать предложенный 10-значный код ТН ВЭД для товара.

Правила:
- Анализируй описание товара и сопоставь с предложенным кодом ТН ВЭД
- Если код подходит — подтверди
- Если код не подходит — предложи более точный 10-значный код
- Если описание слишком расплывчатое для точной классификации — укажи это
- Отвечай ТОЛЬКО валидным JSON, без markdown-обёртки`;

const BATCH_SIZE = 10;

@Injectable()
export class VerificationService {
  private logger = new Logger(VerificationService.name);

  constructor(
    @Optional() @Inject(Anthropic) private anthropic: Anthropic | null,
    private tksApi: TksApiClient,
  ) {}

  get enabled(): boolean {
    return this.anthropic !== null;
  }

  async verify(products: ClassifiedProduct[]): Promise<VerifiedProduct[]> {
    if (!this.anthropic) {
      this.logger.warn('ANTHROPIC_API_KEY not set, skipping verification');
      return products.map((p) => ({
        ...p,
        verified: false,
        suggestedCode: null,
        verificationComment: 'Верификация отключена (нет API-ключа)',
        notes: [
          ...p.notes,
          verifyNote(
            'warning',
            'Верификация кода ТН ВЭД через ИИ пропущена — не настроен ANTHROPIC_API_KEY.',
          ),
        ],
      }));
    }

    const results: VerifiedProduct[] = [];

    // Обрабатываем батчами чтобы не перегружать один запрос
    for (let i = 0; i < products.length; i += BATCH_SIZE) {
      const batch = products.slice(i, i + BATCH_SIZE);
      const batchResults = await this.verifyBatch(batch);
      results.push(...batchResults);
    }

    const verifiedCount = results.filter((r) => r.verified).length;
    this.logger.log(`Verified ${results.length} products: ${verifiedCount} confirmed`);
    return results;
  }

  private async verifyBatch(products: ClassifiedProduct[]): Promise<VerifiedProduct[]> {
    const items = products.map((p, i) => ({
      index: i,
      description: p.description,
      proposedCode: p.tnVedCode,
      proposedDescription: p.tnVedDescription,
      matched: p.matched,
    }));

    const userPrompt = `Верифицируй коды ТН ВЭД для следующих товаров:

${JSON.stringify(items, null, 2)}

Для каждого товара ответь JSON-массивом объектов:
[
  {
    "index": 0,
    "correct": true/false,
    "suggestedCode": "1234567890" или null (если correct=true),
    "comment": "краткое пояснение",
    "confidence": 0.0-1.0
  }
]

Если proposedCode пустой (товар не найден) — предложи свой вариант в suggestedCode.
Отвечай ТОЛЬКО JSON-массивом.`;

    let text: string | undefined;
    try {
      const response = await this.anthropic!.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 2048,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: userPrompt }],
      });

      text = extractClaudeText(response);

      const parsed = parseClaudeJson(text);
      if (!Array.isArray(parsed)) {
        throw new Error(`Expected JSON array from Claude, got: ${typeof parsed}`);
      }
      return this.applyResults(products, parsed as VerificationResult[]);
    } catch (err) {
      this.logger.error(
        `Claude verification failed: ${err instanceof Error ? err.message : String(err)}. Raw response: ${text ?? '(no response received)'}`,
      );
      return products.map((p) => ({
        ...p,
        verified: false,
        suggestedCode: null,
        verificationComment: 'Ошибка верификации',
        notes: [
          ...p.notes,
          verifyNote(
            'warning',
            'Верификация кода ТН ВЭД через ИИ завершилась ошибкой. Код используется в том виде, в котором его предложил классификатор TKS.',
          ),
        ],
      }));
    }
  }

  private async applyResults(
    products: ClassifiedProduct[],
    results: VerificationResult[],
  ): Promise<VerifiedProduct[]> {
    const resultsByIndex = new Map(results.map((r) => [r.index, r]));

    // Предзагрузка TKS-данных для всех suggested codes параллельно
    const codesToFetch = new Set<string>();
    for (const r of results) {
      if (!r.correct && r.suggestedCode && /^\d{10}$/.test(r.suggestedCode)) {
        codesToFetch.add(r.suggestedCode);
      }
    }
    const tnvedCache = new Map<string, Awaited<ReturnType<TksApiClient['getTnvedCode']>>>();
    await Promise.all(
      [...codesToFetch].map(async (code) => {
        try {
          tnvedCache.set(code, await this.tksApi.getTnvedCode(code));
        } catch {
          /* код не найден — пропускаем */
        }
      }),
    );

    const verified: VerifiedProduct[] = [];

    for (let i = 0; i < products.length; i++) {
      const product = products[i];
      const result = resultsByIndex.get(i);

      if (!result) {
        verified.push({
          ...product,
          verified: false,
          suggestedCode: null,
          verificationComment: 'Нет ответа от верификатора',
          notes: [
            ...product.notes,
            verifyNote(
              'warning',
              'Верификатор не вернул результат по этой строке — используется код от классификатора TKS.',
            ),
          ],
        });
        continue;
      }

      if (result.correct) {
        const notes = [...product.notes];
        if (result.comment && result.comment.trim()) {
          notes.push(verifyNote('info', `Верификация ИИ: ${result.comment}`));
        }
        verified.push({
          ...product,
          verified: true,
          suggestedCode: null,
          verificationComment: result.comment,
          matchConfidence: Math.max(product.matchConfidence, result.confidence),
          notes,
        });
      } else if (result.suggestedCode && /^\d{10}$/.test(result.suggestedCode)) {
        const tnved = tnvedCache.get(result.suggestedCode);
        if (tnved) {
          const rates = tnved.TNVED ?? {};
          verified.push({
            ...product,
            tnVedCode: tnved.CODE,
            tnVedDescription: tnved.KR_NAIM,
            dutyRate: rates.IMP ?? product.dutyRate,
            dutySign: rates.IMPSIGN ?? product.dutySign,
            dutyMin: rates.IMP2 ?? product.dutyMin,
            dutyMinUnit: rates.IMPEDI2 ?? product.dutyMinUnit,
            vatRate: rates.NDS ?? product.vatRate,
            exciseRate: rates.AKC ?? product.exciseRate,
            matchConfidence: result.confidence,
            matched: true,
            verified: true,
            suggestedCode: result.suggestedCode,
            verificationComment: result.comment,
            tnvedRaw: tnved,
            notes: [
              ...product.notes,
              verifyNote(
                'warning',
                `ИИ заменил код классификатора на ${result.suggestedCode}: ${result.comment}`,
              ),
            ],
          });
        } else {
          verified.push({
            ...product,
            verified: false,
            suggestedCode: result.suggestedCode,
            verificationComment: `${result.comment} (код ${result.suggestedCode} не найден в справочнике)`,
            notes: [
              ...product.notes,
              verifyNote(
                'warning',
                `ИИ предложил код ${result.suggestedCode}, но он не найден в справочнике TKS. Используется исходный код классификатора. ${result.comment}`,
              ),
            ],
          });
        }
      } else {
        verified.push({
          ...product,
          verified: false,
          suggestedCode: result.suggestedCode,
          verificationComment: result.comment,
          notes: [...product.notes, verifyNote('warning', `ИИ не подтвердил код: ${result.comment}`)],
        });
      }
    }

    return verified;
  }
}
