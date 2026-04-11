import Anthropic from '@anthropic-ai/sdk';
import { TksApiClient, TnvedCode } from '@direct-port/tks-api';
import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import type { VerifiedProduct } from '../verification/verification.service';
import { DutyInterpretation, InterpretedProduct } from './interfaces';

const BATCH_SIZE = 5;
const CACHE_TTL = 3600_000; // 1 hour

const SYSTEM_PROMPT = `Ты — эксперт по таможенному регулированию ЕАЭС. Твоя задача — интерпретировать ставки пошлин, акцизов и НДС из справочника ТН ВЭД и выразить их как формализованные правила расчёта.

Для каждого кода ТН ВЭД ты получаешь:
- Полный объект ставок (TNVED) со всеми полями (IMP, IMP2, IMP3, IMPSIGN, IMPEDI, IMPEDI2, AKC, NDS, IMPTMP, IMPDEMP, IMPCOMP и др.)
- Массив Tnvedall с условиями применения (PRIZNAK, MIN/MAX, единицы измерения)
- Краткое наименование товара (KR_NAIM)

Правила интерпретации:
1. IMP — адвалорная ставка ввозной пошлины (% от таможенной стоимости)
2. IMP2 + IMPEDI2 — специфическая составляющая (фиксированная сумма за единицу: EUR/кг, EUR/л, EUR/м2, EUR/шт)
3. IMPSIGN: '>' = "но не менее" (max из адвалорной и специфической), '<' = "но не более" (min)
4. AKC — акциз. Может быть адвалорный (%) или специфический. AKCEDI указывает единицу
5. NDS — НДС. Обычно 20%, иногда 10% для продуктов, лекарств, детских товаров
6. IMPTMP — временная пошлина, IMPDEMP — антидемпинговая, IMPCOMP — компенсационная. Добавляй как отдельные начисления если ненулевые
7. База: пошлина от customs_value, акциз от customs_value, НДС от customs_value_plus_duty_plus_excise
8. В поле "per" указывай единицу для специфических ставок: kg, m2, l, pcs, m3 и т.д.

Выдавай ТОЛЬКО валидный JSON-массив. Без markdown-обёртки.`;

@Injectable()
export class DutyInterpreterService {
  private logger = new Logger(DutyInterpreterService.name);
  private cache = new Map<string, { data: DutyInterpretation; expiresAt: number }>();

  constructor(
    @Optional() @Inject(Anthropic) private anthropic: Anthropic | null,
    private tksApi: TksApiClient,
  ) {}

  async interpret(products: VerifiedProduct[]): Promise<InterpretedProduct[]> {
    if (!this.anthropic) {
      return products.map((p) => ({ ...p, dutyInterpretation: null }));
    }

    // Group by unique TNVED code
    const codeToIndices = new Map<string, number[]>();
    for (let i = 0; i < products.length; i++) {
      const code = products[i].tnVedCode;
      if (!code) continue;
      const indices = codeToIndices.get(code) ?? [];
      indices.push(i);
      codeToIndices.set(code, indices);
    }

    // Check cache, collect codes that need interpretation
    const interpretations = new Map<string, DutyInterpretation>();
    const codesToInterpret: string[] = [];

    for (const code of codeToIndices.keys()) {
      const cached = this.cache.get(code);
      if (cached && cached.expiresAt > Date.now()) {
        interpretations.set(code, cached.data);
      } else {
        codesToInterpret.push(code);
      }
    }

    // Fetch full TNVED data for uncached codes
    const tnvedData = new Map<string, TnvedCode>();
    await Promise.all(
      codesToInterpret.map(async (code) => {
        try {
          const raw = products.find((p) => p.tnVedCode === code)?.tnvedRaw;
          if (raw) {
            tnvedData.set(code, raw);
          } else {
            tnvedData.set(code, await this.tksApi.getTnvedCode(code));
          }
        } catch {
          this.logger.warn(`Failed to fetch TNVED data for ${code}`);
        }
      }),
    );

    // Batch interpret via Claude
    const validCodes = codesToInterpret.filter((c) => tnvedData.has(c));
    for (let i = 0; i < validCodes.length; i += BATCH_SIZE) {
      const batch = validCodes.slice(i, i + BATCH_SIZE);
      const batchData = batch.map((code) => ({
        code,
        tnved: tnvedData.get(code)!,
      }));

      try {
        const results = await this.interpretBatch(batchData);
        for (const result of results) {
          interpretations.set(result.tnvedCode, result);
          this.cache.set(result.tnvedCode, {
            data: result,
            expiresAt: Date.now() + CACHE_TTL,
          });
        }
      } catch (err) {
        this.logger.error(`Duty interpretation batch failed`, err);
      }
    }

    // Apply interpretations to products
    return products.map((p) => ({
      ...p,
      dutyInterpretation: interpretations.get(p.tnVedCode) ?? null,
    }));
  }

  private async interpretBatch(
    items: Array<{ code: string; tnved: TnvedCode }>,
  ): Promise<DutyInterpretation[]> {
    const codesData = items.map((item) => ({
      code: item.code,
      kr_naim: item.tnved.KR_NAIM,
      rates: item.tnved.TNVED ?? {},
      conditions: item.tnved.Tnvedall ?? [],
    }));

    const userPrompt = `Интерпретируй ставки пошлин для следующих кодов ТН ВЭД:

<codes>
${JSON.stringify(codesData, null, 2)}
</codes>

Для каждого кода верни объект:
{
  "tnvedCode": "1234567890",
  "charges": [
    {
      "type": "import_duty" | "excise" | "vat" | "antidumping" | "compensatory" | "temp_duty",
      "label": "Описание на русском",
      "method": { "kind": "ad_valorem", "rate": число }
             | { "kind": "specific", "amount": число, "unit": "EUR", "per": "kg" }
             | { "kind": "combined_min", "rate": число, "specificAmount": число, "unit": "EUR", "per": "kg" }
             | { "kind": "combined_max", "rate": число, "specificAmount": число, "unit": "EUR", "per": "kg" }
             | { "kind": "fixed_rate", "rate": число },
      "base": "customs_value" | "customs_value_plus_duty" | "customs_value_plus_duty_plus_excise"
    }
  ],
  "requiredDimensions": ["area", "volume"],
  "reasoning": "Пояснение логики"
}

Отвечай ТОЛЬКО JSON-массивом.`;

    const response = await this.anthropic!.messages.create(
      {
        model: 'claude-sonnet-4-6',
        max_tokens: 2048,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: userPrompt }],
      },
      { timeout: 30_000 },
    );

    const text = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('');

    let cleaned = text.trim();
    if (cleaned.startsWith('```')) {
      cleaned = cleaned.replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '');
    }

    const parsed = JSON.parse(cleaned);
    if (!Array.isArray(parsed)) {
      throw new Error('Expected JSON array from Claude');
    }

    return parsed as DutyInterpretation[];
  }
}
