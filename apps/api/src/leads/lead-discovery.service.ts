import Anthropic from '@anthropic-ai/sdk';
import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AiConfigService } from '../ai-config/ai-config.service';
import { systemPrompt } from '../common/claude';
import { modelFamily } from '../common/token-usage';
import { AiUsageLog } from '../database/entities/ai-usage-log.entity';

/** Компания-кандидат, найденная discovery (до обогащения). */
export interface DiscoveredCompany {
  name: string;
  website: string | null;
  city: string | null;
}

interface RawCandidate {
  name?: unknown;
  website?: unknown;
  city?: unknown;
}

/** Максимум обращений к модели за один discovery (защита от зацикливания на pause_turn). */
const MAX_TURNS = 6;
const DISCOVERY_TIMEOUT_MS = 120_000;

const SYSTEM_PROMPT = `Ты — ассистент отдела продаж DirectPort. DirectPort рассчитывает таможенные пошлины/налоги и оформляет декларации для компаний, импортирующих товары в Россию.

Задача: с помощью веб-поиска найти РЕАЛЬНЫЕ российские компании — потенциальных клиентов: импортёров, ВЭД-аутсорсеров, таможенных представителей/брокеров, логистов с услугой растаможки по заданному городу/нише.

Правила:
- Используй инструмент web_search (несколько запросов: по городу, по нише, по «таможенное оформление», «импорт из Китая», «ВЭД услуги» и т. п.).
- Бери только реально существующие компании с сайтом из результатов поиска. НЕ выдумывай названия и домены.
- Не включай агрегаторы, справочники, маркетплейсы и сам tks.ru — нужны конкретные компании.
- Когда собрал список — ОБЯЗАТЕЛЬНО вызови инструмент report_companies со всеми кандидатами. Не отвечай просто текстом.`;

const REPORT_TOOL: Anthropic.Messages.Tool = {
  name: 'report_companies',
  description: 'Сообщить найденные компании-кандидаты для базы лидов',
  input_schema: {
    type: 'object' as const,
    properties: {
      companies: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'Название компании' },
            website: { type: 'string', description: 'URL сайта (если найден)' },
            city: { type: 'string', description: 'Город' },
          },
          required: ['name'],
        },
      },
    },
    required: ['companies'],
  },
};

/**
 * Discovery лидов через server-side web_search. Claude ищет компании в вебе и
 * возвращает структурированный список через client-tool report_companies.
 * Это НЕ через callClaudeTool: нужен server-tool + tool_choice=auto + цикл по
 * pause_turn, чего общий helper не покрывает. Токены → ai_usage_log (lead_discover).
 */
@Injectable()
export class LeadDiscoveryService {
  private logger = new Logger(LeadDiscoveryService.name);

  constructor(
    private readonly aiConfig: AiConfigService,
    @InjectRepository(AiUsageLog) private readonly aiUsageLogRepo: Repository<AiUsageLog>,
    @Optional() @Inject(Anthropic) private readonly anthropic: Anthropic | null = null,
  ) {}

  get available(): boolean {
    return this.anthropic !== null;
  }

  async discover(
    query: string,
    opts: { city?: string; maxResults?: number } = {},
  ): Promise<DiscoveredCompany[]> {
    if (!this.anthropic) {
      throw new Error('ANTHROPIC_API_KEY не настроен — discovery недоступен');
    }
    const maxResults = opts.maxResults ?? 10;
    const model = await this.aiConfig.getLeadDiscoveryModel();

    const prompt =
      `Найди до ${maxResults} компаний по запросу: «${query}».` +
      (opts.city ? ` Город: ${opts.city}.` : '') +
      ` Для каждой укажи название и сайт. В конце вызови report_companies.`;

    const tools: Anthropic.Messages.ToolUnion[] = [
      { type: 'web_search_20260209', name: 'web_search' },
      REPORT_TOOL,
    ];
    const messages: Anthropic.MessageParam[] = [{ role: 'user', content: prompt }];

    for (let turn = 0; turn < MAX_TURNS; turn++) {
      const response = await this.anthropic.messages.create(
        {
          model,
          max_tokens: 4096,
          system: systemPrompt(SYSTEM_PROMPT),
          messages,
          tools,
          tool_choice: { type: 'auto' },
        },
        { timeout: DISCOVERY_TIMEOUT_MS },
      );
      void this.logUsage(model, response.usage);

      const report = response.content.find(
        (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use' && b.name === 'report_companies',
      );
      if (report) {
        const companies = (report.input as { companies?: RawCandidate[] }).companies ?? [];
        return this.normalize(companies, opts.city ?? null).slice(0, maxResults);
      }

      // Server-tool loop упёрся в лимит итераций — продолжаем тот же ход.
      if (response.stop_reason === 'pause_turn') {
        messages.push({ role: 'assistant', content: response.content });
        continue;
      }

      // Claude закончил без вызова report_companies — дальше крутить смысла нет.
      break;
    }

    this.logger.warn(`Discovery «${query}» завершился без report_companies`);
    return [];
  }

  private normalize(raw: RawCandidate[], fallbackCity: string | null): DiscoveredCompany[] {
    const out: DiscoveredCompany[] = [];
    for (const c of raw) {
      const name = typeof c.name === 'string' ? c.name.trim() : '';
      if (!name) continue;
      out.push({
        name,
        website: typeof c.website === 'string' && c.website.trim() ? c.website.trim() : null,
        city: typeof c.city === 'string' && c.city.trim() ? c.city.trim() : fallbackCity,
      });
    }
    return out;
  }

  private async logUsage(model: string, usage: Anthropic.Message['usage']): Promise<void> {
    try {
      await this.aiUsageLogRepo.save({
        model: modelFamily(model),
        purpose: 'lead_discover',
        inputTokens: usage.input_tokens,
        outputTokens: usage.output_tokens,
        cacheCreationTokens: usage.cache_creation_input_tokens ?? 0,
        cacheReadTokens: usage.cache_read_input_tokens ?? 0,
      });
    } catch (err) {
      this.logger.warn('Failed to log lead_discover token usage', err);
    }
  }
}
