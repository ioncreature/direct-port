import Anthropic from '@anthropic-ai/sdk';
import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { AiConfigService } from '../ai-config/ai-config.service';
import {
  CLAUDE_TIMEOUT_UI_MS,
  cacheTools,
  extractToolInput,
  systemPrompt,
} from '../common/claude';
import { errMsg } from '../common/errors';
import { modelFamily } from '../common/token-usage';
import { AiUsageLog } from '../database/entities/ai-usage-log.entity';
import { RegulatoryInterpretationCache } from '../database/entities/regulatory-interpretation-cache.entity';
import { ASSESSMENT_FORMS, type AssessmentForm, type RegulatoryExplanation, type RegulatoryItem } from './interfaces';
import { noteHash } from './note-hash';

const BATCH_SIZE = 5;
const CONCURRENCY = 2;
const CACHE_TTL_MS = 3600_000; // 1 hour (in-memory)
const PERSISTENT_CACHE_TTL_MS = 180 * 24 * 3600_000; // 180 days (DB)
/** NOTE длиннее этого порога отправляется в Claude поодиночке — иначе батч раздувается. */
const HEAVY_NOTE_THRESHOLD = 4000;
/** Суммарный размер NOTE-текста в одном батче. */
const BATCH_PAYLOAD_LIMIT = 8000;
/** Жёсткий потолок L1-кэша. Уникальные NOTE-тексты с временем нарастают, а L2 (БД)
 *  всё равно держит их 180 дней — L1 нужен только для повторных хитов в течение часа. */
const L1_CACHE_MAX_ENTRIES = 5000;


const SYSTEM_PROMPT = `Ты — эксперт по таможенному регулированию ЕАЭС и нетарифным мерам импорта/экспорта в Российскую Федерацию.

Твоя задача: для каждой записи NOTE из справочника TKS дать развёрнутую сводку (4–7 предложений на русском), отвечающую на четыре вопроса:
1. ЧТО именно требуется — форма документа: декларация о соответствии, сертификат соответствия, СГР (государственная регистрация Роспотребнадзора), нотификация (например, ФСБ для криптографии), разрешение/заключение, лицензия Минпромторга, утилизационный/экологический сбор.
2. КТО требует — ведомство (Минпромторг, Роспотребнадзор, Минцифры/Роскомнадзор, Росздравнадзор, Росприроднадзор, ФСБ России, Минобороны и т. п.).
3. НА ОСНОВАНИИ ЧЕГО — ссылка на нормативный документ, упомянутый в NOTE: ТР ТС N/YYYY, ТР ЕАЭС N/YYYY, ПП РФ, ФЗ, Решения ЕЭК.
4. КЛЮЧЕВЫЕ НЮАНСЫ — условия применения (например: «применяется только для оборудования во взрывоопасных средах», «маркировка вступает в силу с 01.05.2026», «лицензия требуется только для опасных отходов в составе»).

ОГРАНИЧЕНИЯ:
- Используй ТОЛЬКО информацию из текста NOTE и метаданных (DOC_N, DOC_D, dateBegin, dateEnd, category). Не добавляй регламенты или ведомства, которых нет в NOTE.
- Если NOTE начинается с «Возможно товар попадает...» — сохраняй неопределённость в формулировках («предположительно», «может потребоваться»).
- Если в NOTE упомянуто несколько ТР или форм — выбирай тот, что наиболее релевантен указанной категории (поле category).
- Если регламент в NOTE не упомянут — regulation = null.
- regulation возвращай в нормализованном виде «ТР ТС N/YYYY» или «ТР ЕАЭС N/YYYY».
- form — одно из: declaration | certificate | state_registration | notification | permit | license | fee | unknown.
- authority — короткое имя ведомства РФ: «Минпромторг России», «Роспотребнадзор», «Минцифры России / Роскомнадзор», «ФСБ России» и т. п. Если ведомство не упомянуто — null.
- summary должен быть самодостаточным — пользователь может не открыть исходный NOTE.

Каждая запись приходит с id (стабильный hash). Возвращай результат с тем же id, чтобы клиент мог сопоставить выжимки с исходными записями.`;

const EXPLAIN_TOOL: Anthropic.Messages.Tool = {
  name: 'explain_regulatory',
  description: 'Расширенные сводки разрешительных мер по NOTE-тексту TKS',
  input_schema: {
    type: 'object' as const,
    properties: {
      items: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string', description: 'Идентификатор из входных данных (передавай без изменений)' },
            summary: {
              type: 'string',
              description: 'Расширенная сводка на русском (4–7 предложений)',
            },
            regulation: {
              type: 'string',
              description: 'Нормализованный идентификатор ТР, например «ТР ТС 020/2011». null если не упомянут.',
            },
            form: { type: 'string', enum: ASSESSMENT_FORMS },
            authority: {
              type: 'string',
              description: 'Короткое имя ведомства РФ или null',
            },
          },
          required: ['id', 'summary'],
        },
      },
    },
    required: ['items'],
  },
};

interface BatchInput {
  /** noteHash (sha256) — ключ кэша */
  hash: string;
  /** id RegulatoryItem (стабильный hex 16) — для связки с фронтом, передаётся в Claude */
  ids: string[];
  category: RegulatoryItem['category'];
  note: string;
  authorityHint: string | null;
  regulationHint: string | null;
  documentRef: { number: string; date: string | null } | null;
}

interface ClaudeItemResponse {
  id: string;
  summary: string;
  regulation?: string | null;
  form?: AssessmentForm;
  authority?: string | null;
}

interface InterpreterResult {
  /** Map itemId → AI-выжимка. Несколько items с одинаковым NOTE-текстом получают одну
   *  и ту же выжимку (один Claude-вызов), но в результате каждый item представлен своим id. */
  byId: Map<string, RegulatoryExplanation>;
  fromDbCache: number;
  fromClaude: number;
  failed: number;
}

@Injectable()
export class RegulatoryInterpreterService {
  private logger = new Logger(RegulatoryInterpreterService.name);
  private cache = new Map<string, { data: RegulatoryExplanation; expiresAt: number }>();

  constructor(
    private readonly aiConfig: AiConfigService,
    @InjectRepository(AiUsageLog) private readonly aiUsageLogRepo: Repository<AiUsageLog>,
    @Optional() @Inject(Anthropic) private readonly anthropic: Anthropic | null = null,
    @Optional()
    @InjectRepository(RegulatoryInterpretationCache)
    private readonly persistentCache: Repository<RegulatoryInterpretationCache> | null = null,
  ) {}

  /**
   * Получает AI-выжимки для всех записей. Группирует одинаковые NOTE в один Claude-вызов,
   * затем разворачивает результат обратно по itemId — внешнему коду не нужно знать о хеше.
   * Если Anthropic SDK не сконфигурирован — возвращает пустой map (UI остаётся на
   * детерминистических summary'ях).
   */
  async explain(items: RegulatoryItem[], language = 'ru'): Promise<InterpreterResult> {
    const result: InterpreterResult = {
      byId: new Map(),
      fromDbCache: 0,
      fromClaude: 0,
      failed: 0,
    };

    const eligible = items.filter((item) => item.rawNote.trim().length > 0);
    if (eligible.length === 0) return result;

    const byHash = new Map<string, BatchInput>();
    for (const item of eligible) {
      const hash = noteHash(item.rawNote);
      const existing = byHash.get(hash);
      if (existing) {
        existing.ids.push(item.id);
        continue;
      }
      byHash.set(hash, {
        hash,
        ids: [item.id],
        category: item.category,
        note: item.rawNote,
        authorityHint: item.authority,
        regulationHint: item.regulation,
        documentRef: item.documentRef,
      });
    }

    const apply = (hash: string, data: RegulatoryExplanation) => {
      const ids = byHash.get(hash)?.ids ?? [];
      for (const id of ids) result.byId.set(id, data);
    };

    // L1/L2 кэш ключуются по (noteHash, language, model): summary зависит от языка,
    // а смена regulatory-модели меняет выжимку. L1 раньше ключевался голым hash и в
    // пределах TTL мог отдать выжимку на чужом языке / от старой модели — поэтому
    // model резолвим и формируем l1Key ДО L1-чтения.
    const model = await this.aiConfig.getRegulatoryInterpreterModel();
    const cacheModelKey = modelFamily(model);
    const l1Key = (hash: string) => `${hash}|${language}|${cacheModelKey}`;

    const need: BatchInput[] = [];
    for (const input of byHash.values()) {
      const cached = this.cache.get(l1Key(input.hash));
      if (cached && cached.expiresAt > Date.now()) {
        apply(input.hash, cached.data);
      } else {
        need.push(input);
      }
    }
    if (need.length === 0) return result;

    if (!this.anthropic) {
      result.failed = need.length;
      return result;
    }

    if (this.persistentCache) {
      const fromDb = await this.loadFromPersistent(
        need.map((n) => n.hash),
        language,
        cacheModelKey,
      );
      for (const [hash, data] of fromDb) {
        apply(hash, data);
        this.rememberInL1(l1Key(hash), data);
      }
      result.fromDbCache = fromDb.size;
    }
    const stillNeed = need.filter((n) => !byHash.get(n.hash)?.ids.every((id) => result.byId.has(id)));
    if (stillNeed.length === 0) return result;

    // Адаптивная упаковка: тяжёлые NOTE — поодиночке, лёгкие в батчах до BATCH_SIZE.
    const batches: BatchInput[][] = [];
    {
      let current: BatchInput[] = [];
      let currentSize = 0;
      const flush = () => {
        if (current.length > 0) {
          batches.push(current);
          current = [];
          currentSize = 0;
        }
      };
      for (const input of stillNeed) {
        const size = input.note.length;
        if (size >= HEAVY_NOTE_THRESHOLD) {
          flush();
          batches.push([input]);
          continue;
        }
        if (current.length >= BATCH_SIZE || (current.length > 0 && currentSize + size > BATCH_PAYLOAD_LIMIT)) {
          flush();
        }
        current.push(input);
        currentSize += size;
      }
      flush();
    }

    const useCache = batches.length > 1;
    const fresh: Array<{ hash: string; data: RegulatoryExplanation }> = [];
    const handleFresh = (items: Array<{ hash: string; data: RegulatoryExplanation }>) => {
      for (const item of items) {
        fresh.push(item);
        apply(item.hash, item.data);
        this.rememberInL1(l1Key(item.hash), item.data);
      }
    };

    if (batches.length > 0) {
      try {
        handleFresh(await this.callClaude(batches[0], language, model, useCache));
      } catch (err) {
        this.logger.error(`Claude regulatory batch failed: ${errMsg(err)}`);
      }
    }

    const remaining = batches.slice(1);
    for (let i = 0; i < remaining.length; i += CONCURRENCY) {
      const group = remaining.slice(i, i + CONCURRENCY);
      const results = await Promise.all(
        group.map((batch) =>
          this.callClaude(batch, language, model, useCache).catch((err) => {
            this.logger.error(`Claude regulatory batch failed: ${errMsg(err)}`);
            return [] as Array<{ hash: string; data: RegulatoryExplanation }>;
          }),
        ),
      );
      for (const items of results) handleFresh(items);
    }

    result.fromClaude = fresh.length;
    result.failed = stillNeed.length - fresh.length;

    if (this.persistentCache && fresh.length > 0) {
      await this.savePersistent(fresh, language, cacheModelKey).catch((err) => {
        this.logger.warn(`Persistent cache save failed: ${errMsg(err)}`);
      });
    }

    this.logger.log(
      `Regulatory explain: total=${eligible.length} unique-notes=${byHash.size} ` +
        `db-hit=${result.fromDbCache} claude=${result.fromClaude} failed=${result.failed}`,
    );
    return result;
  }

  /**
   * Кладёт запись в L1 с жёстким потолком L1_CACHE_MAX_ENTRIES. Map в JS сохраняет
   * порядок вставки — при переполнении удаляем самую старую (FIFO-приближение к LRU).
   * Для горячего хита это не идеальная LRU, но цель здесь — защита от неограниченного
   * роста; точная LRU не нужна (L2 закрывает 180-дневное хранение).
   */
  private rememberInL1(key: string, data: RegulatoryExplanation): void {
    if (this.cache.has(key)) this.cache.delete(key);
    else if (this.cache.size >= L1_CACHE_MAX_ENTRIES) {
      const oldest = this.cache.keys().next().value;
      if (oldest !== undefined) this.cache.delete(oldest);
    }
    this.cache.set(key, { data, expiresAt: Date.now() + CACHE_TTL_MS });
  }

  private async loadFromPersistent(
    hashes: string[],
    language: string,
    model: string,
  ): Promise<Map<string, RegulatoryExplanation>> {
    const result = new Map<string, RegulatoryExplanation>();
    if (!this.persistentCache || hashes.length === 0) return result;
    try {
      const cutoff = new Date(Date.now() - PERSISTENT_CACHE_TTL_MS);
      const rows = await this.persistentCache.find({
        where: { noteHash: In(hashes), language, model },
      });
      for (const row of rows) {
        if (row.fetchedAt >= cutoff) result.set(row.noteHash, row.explanation);
      }
    } catch (err) {
      this.logger.warn(`Persistent cache lookup failed: ${errMsg(err)}`);
    }
    return result;
  }

  private async savePersistent(
    fresh: Array<{ hash: string; data: RegulatoryExplanation }>,
    language: string,
    model: string,
  ): Promise<void> {
    if (!this.persistentCache || fresh.length === 0) return;
    const now = new Date();
    const rows = fresh.map(({ hash, data }) => ({
      noteHash: hash,
      language,
      model,
      explanation: data,
      fetchedAt: now,
    }));
    await this.persistentCache
      .createQueryBuilder()
      .insert()
      .into(RegulatoryInterpretationCache)
      .values(rows)
      .orUpdate(['explanation', 'fetched_at'], ['note_hash', 'language', 'model'])
      .execute();
  }

  private async callClaude(
    batch: BatchInput[],
    language: string,
    model: string,
    useCache: boolean,
  ): Promise<Array<{ hash: string; data: RegulatoryExplanation }>> {
    const payload = batch.map((b) => ({
      // Внутри батча достаточно одной id-пары, но реально item.id и hash 1:1
      // соответствуют (мы группируем по hash); первый id из массива достаточно.
      id: b.ids[0],
      hash: b.hash,
      category: b.category,
      regulationHint: b.regulationHint,
      authorityHint: b.authorityHint,
      documentRef: b.documentRef,
      note: b.note,
    }));

    const userPrompt = `Сформируй расширенную сводку для каждой записи. Поле note — исходный текст NOTE из справочника TKS. category, regulationHint, authorityHint, documentRef — извлечения детерминистическим парсером (используй как подсказки; перепроверь по тексту).
Язык ответа: ${language === 'ru' ? 'русский' : language}.

<items>
${JSON.stringify(payload, null, 2)}
</items>`;

    const response = await this.anthropic!.messages.create(
      {
        model,
        max_tokens: 4096,
        system: systemPrompt(SYSTEM_PROMPT, useCache),
        messages: [{ role: 'user', content: userPrompt }],
        tools: cacheTools([EXPLAIN_TOOL], useCache),
        tool_choice: { type: 'tool', name: EXPLAIN_TOOL.name },
      },
      { timeout: CLAUDE_TIMEOUT_UI_MS },
    );

    this.logUsage(model, response.usage).catch(() => {});

    const parsed = extractToolInput<{ items: ClaudeItemResponse[] }>(response);
    const idToHash = new Map<string, string>();
    for (const b of batch) for (const id of b.ids) idToHash.set(id, b.hash);

    const out: Array<{ hash: string; data: RegulatoryExplanation }> = [];
    const seen = new Set<string>();
    for (const item of parsed.items ?? []) {
      const hash = idToHash.get(item.id);
      if (!hash || seen.has(hash)) continue;
      seen.add(hash);
      const form = item.form && (ASSESSMENT_FORMS as readonly string[]).includes(item.form) ? item.form : null;
      out.push({
        hash,
        data: {
          summary: item.summary?.trim() ?? '',
          regulation: item.regulation?.trim() || null,
          form,
          authority: item.authority?.trim() || null,
        },
      });
    }
    return out;
  }

  private async logUsage(model: string, usage: Anthropic.Message['usage']): Promise<void> {
    await this.aiUsageLogRepo.save({
      model: modelFamily(model),
      purpose: 'regulatory_interpret',
      inputTokens: usage.input_tokens,
      outputTokens: usage.output_tokens,
      cacheCreationTokens: usage.cache_creation_input_tokens ?? 0,
      cacheReadTokens: usage.cache_read_input_tokens ?? 0,
    });
  }
}
