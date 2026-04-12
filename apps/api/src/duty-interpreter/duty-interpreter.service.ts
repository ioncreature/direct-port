import Anthropic from '@anthropic-ai/sdk';
import { TksApiClient, TnvedCode } from '@direct-port/tks-api';
import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { extractClaudeText, parseClaudeJson } from '../common/claude';
import type { ProductNote } from '../common/product-notes';
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
      return products.map((p) => {
        const extraNotes: ProductNote[] = [];
        if (this.hasNonTrivialRates(p)) {
          extraNotes.push({
            stage: 'interpret',
            severity: 'warning',
            field: 'duty',
            message:
              'У кода ТН ВЭД есть нетривиальные ставки (специфическая или комбинированная часть), но AI-интерпретатор отключён (нет ANTHROPIC_API_KEY). Расчёт будет выполнен по упрощённым правилам TKS.',
          });
        }
        return { ...p, dutyInterpretation: null, notes: [...p.notes, ...extraNotes] };
      });
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
    return products.map((p) => {
      const interpretation = interpretations.get(p.tnVedCode) ?? null;
      const extraNotes: ProductNote[] = [];

      if (interpretation?.reasoning) {
        extraNotes.push({
          stage: 'interpret',
          severity: 'info',
          field: 'duty',
          message: `Интерпретация ставок: ${interpretation.reasoning}`,
        });
      }

      if (!interpretation && p.tnVedCode && this.hasNonTrivialRates(p)) {
        extraNotes.push({
          stage: 'interpret',
          severity: 'warning',
          field: 'duty',
          message:
            'AI-интерпретация ставок не получена (Claude вернул пустой ответ или была ошибка). Расчёт использует упрощённые правила TKS.',
        });
      }

      return {
        ...p,
        dutyInterpretation: interpretation,
        notes: [...p.notes, ...extraNotes],
      };
    });
  }

  /**
   * Есть ли у товара нетривиальные ставки, для корректной обработки которых нужен AI?
   * Триггеры: специфическая часть (IMP2), комбинированная ставка (IMPSIGN), акциз не 0,
   * антидемпинговая/компенсационная/временная пошлина.
   */
  private hasNonTrivialRates(p: VerifiedProduct): boolean {
    const rates = p.tnvedRaw?.TNVED;
    if (!rates) {
      // Работаем по denormalized полям
      return (
        (p.dutyMin != null && p.dutyMin > 0) ||
        !!p.dutySign ||
        (p.exciseRate != null && p.exciseRate > 0)
      );
    }
    return (
      (rates.IMP2 != null && rates.IMP2 > 0) ||
      !!rates.IMPSIGN ||
      (rates.AKC != null && rates.AKC > 0) ||
      (rates.IMPTMP != null && rates.IMPTMP > 0) ||
      (rates.IMPDEMP != null && rates.IMPDEMP > 0) ||
      (rates.IMPCOMP != null && rates.IMPCOMP > 0)
    );
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

    const text = extractClaudeText(response);

    const parsed = parseClaudeJson(text);
    if (!Array.isArray(parsed)) {
      throw new Error('Expected JSON array from Claude');
    }

    return parsed as DutyInterpretation[];
  }
}
