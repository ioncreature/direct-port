import Anthropic from '@anthropic-ai/sdk';
import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AiConfigService } from '../ai-config/ai-config.service';
import { CLAUDE_TIMEOUT_UI_MS, extractToolInput, systemPrompt } from '../common/claude';
import { modelFamily } from '../common/token-usage';
import { AiUsageLog } from '../database/entities/ai-usage-log.entity';
import { Lead } from '../database/entities/lead.entity';
import { clampScore, cleanStringList, fetchPageText, toFetchUrl } from './lead-utils';

/** Извлечённый и оценённый профиль лида (что кладём в Lead после обогащения). */
export interface LeadEnrichment {
  phones: string[] | null;
  emails: string[] | null;
  inn: string | null;
  city: string | null;
  services: string[] | null;
  doesImport: boolean | null;
  importDirections: string[] | null;
  relevanceScore: number | null;
  relevanceReason: string | null;
}

interface RawEnrichment {
  relevanceScore?: number;
  relevanceReason?: string;
  doesImport?: boolean;
  importDirections?: unknown;
  services?: unknown;
  phones?: unknown;
  emails?: unknown;
  inn?: unknown;
  city?: unknown;
}

const SYSTEM_PROMPT = `Ты — аналитик отдела продаж DirectPort. DirectPort — сервис, который рассчитывает таможенные пошлины и налоги и оформляет декларации для компаний, импортирующих товары в Россию (особенно из Китая).

Тебе дают название компании и текст её сайта. Задача — извлечь контакты и оценить, насколько компания подходит как потенциальный клиент DirectPort.

ЦА DirectPort — это компании, которые РЕАЛЬНО импортируют товары в РФ или оформляют импорт за клиентов: импортёры-оптовики, ВЭД-аутсорсеры, таможенные представители/брокеры, логисты с услугой растаможки.

НЕ ЦА — компании без признаков ВЭД: внутрироссийские грузоперевозки (фуры по РФ), складские услуги без импорта, локальная розница, услуги не связанные с импортом.

Оцени relevanceScore от 0 до 1:
- 0.8–1.0 — явные признаки импорта/ВЭД/растаможки, направления (Китай, Турция, Европа), упоминания ТН ВЭД, таможенного оформления.
- 0.4–0.7 — логистика/ВЭД-смежное, но прямого импорта не видно.
- 0.0–0.3 — нет признаков импорта, скорее не наша ЦА.

relevanceReason — 1–2 предложения на русском: почему такой балл, какие сигналы нашёл (это пойдёт в первую строку холодного письма менеджера).

Извлекай ТОЛЬКО то, что реально есть в тексте. Не выдумывай контакты и ИНН. Телефоны и email — как написаны на сайте.`;

const ENRICH_TOOL: Anthropic.Messages.Tool = {
  name: 'report_lead',
  description: 'Структурированный профиль и скоринг компании по тексту её сайта',
  input_schema: {
    type: 'object' as const,
    properties: {
      relevanceScore: {
        type: 'number',
        description: 'Насколько компания подходит как клиент DirectPort, от 0 до 1',
      },
      relevanceReason: {
        type: 'string',
        description: 'Краткое обоснование балла на русском (1–2 предложения)',
      },
      doesImport: {
        type: 'boolean',
        description: 'Есть ли на сайте признаки реального импорта/ВЭД/растаможки',
      },
      importDirections: {
        type: 'array',
        items: { type: 'string' },
        description: 'Страны/регионы импорта, если упомянуты (Китай, Турция …)',
      },
      services: {
        type: 'array',
        items: { type: 'string' },
        description: 'Ключевые услуги/направления деятельности',
      },
      phones: { type: 'array', items: { type: 'string' }, description: 'Телефоны с сайта' },
      emails: { type: 'array', items: { type: 'string' }, description: 'Email с сайта' },
      inn: { type: 'string', description: 'ИНН, если найден на сайте' },
      city: { type: 'string', description: 'Город компании, если указан' },
    },
    required: ['relevanceScore', 'relevanceReason', 'doesImport'],
  },
};

/**
 * Обогащение лида: скачивает сайт обычным HTTP, обрезает HTML до текста и отдаёт
 * Claude (haiku по умолчанию) на извлечение контактов + скоринг релевантности.
 * Вне-pipeline вызов — токены пишутся в ai_usage_log (purpose=lead_enrich),
 * как у translate/regulatory_interpret.
 */
@Injectable()
export class LeadEnrichmentService {
  private logger = new Logger(LeadEnrichmentService.name);

  constructor(
    private readonly aiConfig: AiConfigService,
    @InjectRepository(AiUsageLog) private readonly aiUsageLogRepo: Repository<AiUsageLog>,
    @Optional() @Inject(Anthropic) private readonly anthropic: Anthropic | null = null,
  ) {}

  get available(): boolean {
    return this.anthropic !== null;
  }

  /**
   * Обогащает один лид. Бросает Error при невозможности (нет ключа/сайта,
   * сайт недоступен, Claude не вернул tool_use) — вызывающий воркер ставит FAILED.
   */
  async enrich(lead: Lead): Promise<LeadEnrichment> {
    if (!this.anthropic) {
      throw new Error('ANTHROPIC_API_KEY не настроен — обогащение недоступно');
    }
    const url = toFetchUrl(lead.website);
    if (!url) {
      throw new Error('у лида нет сайта для обогащения');
    }

    const pageText = await fetchPageText(url, { maxChars: 12_000, timeoutMs: 15_000 });
    if (pageText.length < 50) {
      throw new Error('сайт вернул слишком мало текста');
    }

    const model = await this.aiConfig.getLeadEnrichmentModel();
    const userMessage =
      `Компания: ${lead.companyName}\n` +
      `Сайт: ${url}\n` +
      (lead.city ? `Город (известный): ${lead.city}\n` : '') +
      `\nТекст сайта:\n${pageText}`;

    const response = await this.anthropic.messages.create(
      {
        model,
        max_tokens: 1024,
        system: systemPrompt(SYSTEM_PROMPT),
        messages: [{ role: 'user', content: userMessage }],
        tools: [ENRICH_TOOL],
        tool_choice: { type: 'tool', name: ENRICH_TOOL.name },
      },
      { timeout: CLAUDE_TIMEOUT_UI_MS },
    );
    void this.logUsage(model, response.usage);

    const raw = extractToolInput<RawEnrichment>(response);
    return this.normalize(raw);
  }

  private normalize(raw: RawEnrichment): LeadEnrichment {
    const inn = typeof raw.inn === 'string' && /\d{8,12}/.test(raw.inn) ? raw.inn.trim() : null;
    const city = typeof raw.city === 'string' && raw.city.trim() ? raw.city.trim() : null;
    return {
      phones: cleanStringList(raw.phones, 10),
      emails: cleanStringList(raw.emails, 10),
      inn,
      city,
      services: cleanStringList(raw.services, 15),
      doesImport: typeof raw.doesImport === 'boolean' ? raw.doesImport : null,
      importDirections: cleanStringList(raw.importDirections, 15),
      relevanceScore: clampScore(raw.relevanceScore),
      relevanceReason:
        typeof raw.relevanceReason === 'string' && raw.relevanceReason.trim()
          ? raw.relevanceReason.trim()
          : null,
    };
  }

  private async logUsage(model: string, usage: Anthropic.Message['usage']): Promise<void> {
    try {
      await this.aiUsageLogRepo.save({
        model: modelFamily(model),
        purpose: 'lead_enrich',
        inputTokens: usage.input_tokens,
        outputTokens: usage.output_tokens,
        cacheCreationTokens: usage.cache_creation_input_tokens ?? 0,
        cacheReadTokens: usage.cache_read_input_tokens ?? 0,
      });
    } catch (err) {
      this.logger.warn('Failed to log lead_enrich token usage', err);
    }
  }
}
