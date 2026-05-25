import type Anthropic from '@anthropic-ai/sdk';
import { TksApiClient, type TnvedCode } from '@direct-port/tks-api';
import { Logger } from '@nestjs/common';
import { AiConfigService } from '../ai-config/ai-config.service';
import { extractToolInput } from '../common/claude';
import { callClaudeTool } from '../common/claude-tool-call';
import { errMsg } from '../common/errors';
import { localizedLanguageName } from '../common/i18n';
import type { ProductNote } from '../common/product-notes';
import {
  emptyTokenUsageMap,
  mergeTokenUsage,
  type TokenUsageMap,
} from '../common/token-usage';
import type { DocumentPhoto } from '../database/entities/document-photo.entity';
import { PhotoStorageService } from '../photo-storage/photo-storage.service';
import {
  PipelineAuditService,
  type AuditContext,
} from '../pipeline-audit/pipeline-audit.service';
import { buildRateFields } from './classification-assembler';
import {
  CLASSIFICATION_CACHE_MAX,
  CLASSIFICATION_CACHE_TTL_MS,
  TtlMap,
} from './classification-cache';
import type { ClassifiedProduct } from './classifier.service';

const VISION_CONCURRENCY = 3;

interface VisionResult {
  tnVedCode: string;
  confidence: number;
  comment: string;
  commentLocalized?: string;
}

const VISION_SYSTEM_PROMPT = `Ты — эксперт по таможенной классификации ТН ВЭД, который верифицирует решение по фотографии товара.

Тебе дают: текстовое описание товара, текущий выбранный 10-значный код ТН ВЭД и фотографию реального товара.

Задача — посмотреть на фото и:
1. Подтвердить текущий код, если фото соответствует описанию и коду — верни тот же tnVedCode с повышенной confidence.
2. Скорректировать код, если фото показывает другой материал/тип товара (например, "Шлейка" в описании, а на фото поводки; "ступица колеса" в описании, а на фото литой диск). Верни новый 10-значный tnVedCode.

Что можно понять по фото товара: материал (металл/пластик/дерево/ткань), тип изделия (готовый продукт vs упаковка vs части), назначение (бытовое/промышленное/детское), наличие электрики, форм-фактор. Используй это для уточнения группы ТН ВЭД.

confidence: 0.0–1.0 — твоя уверенность по итогу (с учётом фото).
comment: 1-2 фразы на русском о том, что увидел на фото и почему это соответствует или не соответствует коду.
`;

const VISION_TOOL: Anthropic.Messages.Tool = {
  name: 'verify_with_photo',
  description: 'Подтверждение или корректировка кода ТН ВЭД по фотографии товара',
  input_schema: {
    type: 'object' as const,
    properties: {
      tnVedCode: { type: 'string', description: '10-значный код ТН ВЭД' },
      confidence: { type: 'number', description: '0.0–1.0' },
      comment: { type: 'string', description: 'Что видно на фото и почему код подходит/не подходит' },
      comment_localized: {
        type: 'string',
        description: 'Тот же комментарий на языке пользователя (если language≠ru)',
      },
    },
    required: ['tnVedCode', 'confidence', 'comment'],
  },
};

/**
 * Phase 4.5 классификации: для строк с низкой текстовой уверенностью отправляем
 * фото товара (если оно есть в `document_photo`) в Claude Vision и подтверждаем
 * либо корректируем код. Plain-class (не @Injectable) — инстанциируется внутри
 * ClassifierService, чтобы DI-граф классификатора и подпись его конструктора
 * остались прежними.
 */
export class VisionRetry {
  private logger = new Logger(VisionRetry.name);
  private cache = new TtlMap<VisionResult>(
    CLASSIFICATION_CACHE_TTL_MS,
    CLASSIFICATION_CACHE_MAX,
  );

  constructor(
    private tksApi: TksApiClient,
    private anthropic: Anthropic | null,
    private aiConfig: AiConfigService,
    private audit: PipelineAuditService,
    private photoStorage: PhotoStorageService | null,
  ) {}

  async run(
    assembled: ClassifiedProduct[],
    confidenceThreshold: number,
    language: string | undefined,
    auditContext: AuditContext | null,
  ): Promise<{ tokenUsage: TokenUsageMap; applied: number }> {
    const skip = (reason: string) => {
      this.logger.log(`Vision retry skipped: ${reason}`);
      return { tokenUsage: emptyTokenUsageMap(), applied: 0 };
    };

    if (!this.anthropic) return skip('no Anthropic client');
    if (!this.photoStorage) return skip('PhotoStorage not wired');
    const documentId = auditContext?.documentId;
    if (!documentId) return skip('auditContext.documentId missing');

    const lowConfIndices: number[] = [];
    for (let i = 0; i < assembled.length; i++) {
      const p = assembled[i];
      if (!p.matched || p.matchConfidence < confidenceThreshold) lowConfIndices.push(i);
    }
    if (lowConfIndices.length === 0) {
      return skip(`no low-confidence rows (threshold=${confidenceThreshold})`);
    }

    const photos = await this.photoStorage.getFirstByRows(documentId, lowConfIndices);
    if (photos.length === 0) {
      return skip(`${lowConfIndices.length} low-conf rows but no photos in document_photo`);
    }

    const photoByRow = new Map<number, DocumentPhoto>();
    for (const ph of photos) photoByRow.set(ph.rowIndex, ph);

    const tasks = lowConfIndices
      .map((i) => ({ index: i, photo: photoByRow.get(i) }))
      .filter((t): t is { index: number; photo: DocumentPhoto } => !!t.photo);
    if (tasks.length === 0) {
      const lowConf = lowConfIndices.join(',');
      const photoRows = photos.map((p) => p.rowIndex).join(',');
      return skip(`photos exist but rowIndex mismatch (lowConf=${lowConf}, photoRows=${photoRows})`);
    }

    const model = await this.aiConfig.getPhotoClassifierModel();
    let totalUsage = emptyTokenUsageMap();

    type TaskResult = { task: { index: number; photo: DocumentPhoto }; result: VisionResult | null };
    const completed: TaskResult[] = [];
    for (let g = 0; g < tasks.length; g += VISION_CONCURRENCY) {
      const batch = tasks.slice(g, g + VISION_CONCURRENCY);
      const batchResults = await Promise.all(
        batch.map(async (t): Promise<TaskResult & { tokenUsage: TokenUsageMap }> => {
          const product = assembled[t.index];
          const cacheKey = [t.photo.imageHash, product.tnVedCode, language ?? 'ru', model].join('\x1F');
          const now = Date.now();
          const cached = this.cache.get(cacheKey, now);
          if (cached) {
            return { task: t, result: cached, tokenUsage: emptyTokenUsageMap() };
          }
          try {
            const { result, tokenUsage } = await this.executeVisionCall(
              product,
              t.photo,
              model,
              language,
              auditContext,
            );
            if (result) {
              this.cache.set(cacheKey, result, now);
            }
            return { task: t, result, tokenUsage };
          } catch (err) {
            this.logger.warn(`Vision call failed for row ${t.index}: ${errMsg(err)}`);
            return { task: t, result: null, tokenUsage: emptyTokenUsageMap() };
          }
        }),
      );
      for (const r of batchResults) {
        totalUsage = mergeTokenUsage(totalUsage, r.tokenUsage);
        completed.push({ task: r.task, result: r.result });
      }
    }

    // Один батчевый loadTnvedRates под все новые коды — иначе N последовательных
    // обращений к TKS (через кэш PgTksCacheStore это дёшево, но всё равно лишние round-trips).
    const newCodesSet = new Set<string>();
    for (const r of completed) {
      if (!r.result) continue;
      const next = r.result.tnVedCode;
      const current = assembled[r.task.index].tnVedCode;
      if (next && next !== current) newCodesSet.add(next);
    }
    const tnvedByNewCode =
      newCodesSet.size > 0
        ? await this.loadTnvedRates([...newCodesSet])
        : new Map<string, TnvedCode>();

    let confirmed = 0;
    let corrected = 0;
    let emptyResults = 0;
    let codesNotInTks = 0;
    for (const r of completed) {
      if (!r.result) {
        emptyResults++;
        continue;
      }
      const before = assembled[r.task.index];
      const updated = this.applyVisionUpdate(before, r.result, tnvedByNewCode);
      if (updated) {
        assembled[r.task.index] = updated;
        if (r.result.tnVedCode === before.tnVedCode) confirmed++;
        else corrected++;
      } else if (r.result.tnVedCode && r.result.tnVedCode !== before.tnVedCode) {
        codesNotInTks++;
      }
    }

    const applied = confirmed + corrected;
    this.logger.log(
      `Vision retry done: tasks=${tasks.length}, confirmed=${confirmed}, corrected=${corrected}, emptyResults=${emptyResults}, codesNotInTks=${codesNotInTks}`,
    );
    return { tokenUsage: totalUsage, applied };
  }

  private async executeVisionCall(
    product: ClassifiedProduct,
    photo: DocumentPhoto,
    model: string,
    language: string | undefined,
    auditContext: AuditContext | null,
  ): Promise<{ result: VisionResult | null; tokenUsage: TokenUsageMap }> {
    if (!this.anthropic) return { result: null, tokenUsage: emptyTokenUsageMap() };

    const localizedHint =
      language && language !== 'ru'
        ? `\nДополнительно: верни comment_localized на ${localizedLanguageName(language)}.`
        : '';
    const userText =
      `Подтверди или скорректируй код ТН ВЭД для товара по фотографии.\n\n` +
      `Текущее описание: ${product.description}\n` +
      (product.rawContext ? `Контекст: ${product.rawContext}\n` : '') +
      `Текущий код: ${product.tnVedCode || '(не определён)'} — ${product.tnVedDescription}\n` +
      `Текущая уверенность: ${product.matchConfidence.toFixed(2)}\n\n` +
      `Если фото подтверждает текущий код — верни тот же tnVedCode и подними confidence. ` +
      `Если фото противоречит описанию (например, фактический материал/тип товара другой) — ` +
      `предложи более подходящий 10-значный код. ` +
      `В comment кратко объясни, что увидел на фото и почему это соответствует или не соответствует коду.${localizedHint}`;

    const sdkMessages = [
      {
        role: 'user' as const,
        content: [
          {
            type: 'image' as const,
            source: {
              type: 'base64' as const,
              media_type: 'image/jpeg' as const,
              data: photo.bytes.toString('base64'),
            },
          },
          { type: 'text' as const, text: userText },
        ],
      },
    ];

    // В audit пишем легковесный request — без base64-байтов, иначе ai_call.request
    // распухнет на ~270 KB на каждый vision-вызов.
    const { response, tokenUsage } = await callClaudeTool(
      this.anthropic,
      this.audit,
      {
        model,
        systemPrompt: VISION_SYSTEM_PROMPT,
        userMessage: sdkMessages,
        tool: VISION_TOOL,
        maxTokens: 1024,
      },
      {
        context: auditContext,
        purpose: 'classify_vision',
        auditRequestOverride: {
          model,
          max_tokens: 1024,
          system: VISION_SYSTEM_PROMPT,
          prompt: userText,
          photoHash: photo.imageHash,
          photoSizeBytes: photo.bytes.length,
          tools: [VISION_TOOL.name],
          tool_choice: 'any',
        },
      },
    );

    const parsed = extractToolInput<{
      tnVedCode: string;
      confidence: number;
      comment: string;
      comment_localized?: string;
    }>(response);
    return {
      result: {
        tnVedCode: String(parsed.tnVedCode ?? '').replace(/\D/g, ''),
        confidence: Math.max(0, Math.min(1, Number(parsed.confidence) || 0)),
        comment: String(parsed.comment ?? ''),
        commentLocalized: parsed.comment_localized
          ? String(parsed.comment_localized)
          : undefined,
      },
      tokenUsage,
    };
  }

  private applyVisionUpdate(
    product: ClassifiedProduct,
    vision: VisionResult,
    tnvedByNewCode: Map<string, TnvedCode>,
  ): ClassifiedProduct | null {
    const sameCode = vision.tnVedCode && vision.tnVedCode === product.tnVedCode;
    const newCode =
      vision.tnVedCode && vision.tnVedCode !== product.tnVedCode ? vision.tnVedCode : null;
    if (!sameCode && !newCode) return null;

    const newTnved = newCode ? tnvedByNewCode.get(newCode) : undefined;
    if (newCode && !newTnved) {
      // Vision предложил код вне справочника — не применяем (как в text-retry).
      return null;
    }

    const note: ProductNote = {
      stage: 'classify',
      severity: 'info',
      field: 'code',
      message: sameCode
        ? `Фото подтвердило код ${product.tnVedCode} (vision conf ${vision.confidence.toFixed(2)}). ${vision.comment}`
        : `Фото скорректировало код ${product.tnVedCode || '(не определён)'} → ${newCode} (vision conf ${vision.confidence.toFixed(2)}). ${vision.comment}`,
      messageLocalized: vision.commentLocalized
        ? sameCode
          ? `Photo confirmed code ${product.tnVedCode} (vision conf ${vision.confidence.toFixed(2)}). ${vision.commentLocalized}`
          : `Photo corrected code ${product.tnVedCode || '(none)'} → ${newCode} (vision conf ${vision.confidence.toFixed(2)}). ${vision.commentLocalized}`
        : undefined,
    };

    if (sameCode) {
      return {
        ...product,
        matchConfidence: Math.max(product.matchConfidence, vision.confidence),
        verified: true,
        notes: [...product.notes, note],
      };
    }

    return {
      ...product,
      ...buildRateFields(newTnved!),
      matchConfidence: vision.confidence,
      matched: true,
      tnvedRaw: newTnved!,
      verified: true,
      suggestedCode: null,
      verificationComment: vision.comment,
      notes: [...product.notes, note],
    };
  }

  private async loadTnvedRates(codes: string[]): Promise<Map<string, TnvedCode>> {
    const map = new Map<string, TnvedCode>();
    await Promise.all(
      codes.map(async (code) => {
        try {
          map.set(code, await this.tksApi.getTnvedCode(code));
        } catch (err) {
          this.logger.warn(`Failed to load TNVED for ${code}: ${errMsg(err)}`);
        }
      }),
    );
    return map;
  }
}
