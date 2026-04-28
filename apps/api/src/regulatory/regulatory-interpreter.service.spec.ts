import type Anthropic from '@anthropic-ai/sdk';
import { createHash } from 'crypto';
import type { Repository } from 'typeorm';
import type { AiConfigService } from '../ai-config/ai-config.service';
import type { AiUsageLog } from '../database/entities/ai-usage-log.entity';
import type { RegulatoryInterpretationCache } from '../database/entities/regulatory-interpretation-cache.entity';
import type { RegulatoryItem } from './interfaces';
import { RegulatoryInterpreterService } from './regulatory-interpreter.service';

function makeItem(overrides: Partial<RegulatoryItem> = {}): RegulatoryItem {
  return {
    id: 'abcd1234abcd1234',
    category: 'certification',
    priznak: 11,
    title: 'ТР ТС 020/2011 — декларация',
    summary: 'short det summary',
    regulation: 'ТР ТС 020/2011',
    regulationTitle: null,
    form: 'declaration',
    authority: 'Минпромторг России',
    documentRef: { number: '768', date: '2011-08-16' },
    validFrom: null,
    validTo: null,
    matchPrecision: 'broad',
    codeRange: { min: '85', max: null },
    countryCode: null,
    countryName: null,
    values: { min: null, max: null, unit: null },
    rawNote: 'Низковольтное оборудование подлежит декларированию соответствия.',
    ...overrides,
  };
}

function makeAnthropicMock(toolInput: unknown): Anthropic {
  return {
    messages: {
      create: jest.fn(async () => ({
        content: [{ type: 'tool_use', name: 'explain_regulatory', input: toolInput }],
        usage: { input_tokens: 100, output_tokens: 50 },
      })),
    },
  } as unknown as Anthropic;
}

function makeService(opts: {
  anthropic?: Anthropic | null;
  cacheRows?: Array<{ noteHash: string; explanation: { summary: string }; fetchedAt: Date }>;
}): {
  service: RegulatoryInterpreterService;
  saveSpy: jest.Mock;
  usageLog: jest.Mock;
} {
  const aiConfig = {
    getRegulatoryInterpreterModel: jest.fn(async () => 'claude-haiku-4-5-20251001'),
  } as unknown as AiConfigService;

  const usageLog = jest.fn(async (row: unknown) => row);
  const aiUsageLogRepo = { save: usageLog } as unknown as Repository<AiUsageLog>;

  const saveSpy = jest.fn();
  const cacheRepo = {
    find: jest.fn(async () => opts.cacheRows ?? []),
    createQueryBuilder: () => ({
      insert: () => ({
        into: () => ({
          values: () => ({
            orUpdate: () => ({ execute: saveSpy }),
          }),
        }),
      }),
    }),
  } as unknown as Repository<RegulatoryInterpretationCache>;

  const service = new RegulatoryInterpreterService(
    aiConfig,
    aiUsageLogRepo,
    opts.anthropic ?? null,
    cacheRepo,
  );
  return { service, saveSpy, usageLog };
}

describe('RegulatoryInterpreterService', () => {
  it('возвращает пустой результат если items без NOTE', async () => {
    const { service } = makeService({});
    const result = await service.explain([makeItem({ rawNote: '' })]);
    expect(result.byId.size).toBe(0);
    expect(result.fromClaude).toBe(0);
  });

  it('без Anthropic возвращает failed для всех записей', async () => {
    const { service } = makeService({ anthropic: null });
    const result = await service.explain([makeItem()]);
    expect(result.byId.size).toBe(0);
    expect(result.failed).toBe(1);
  });

  it('возвращает выжимку из L2-кэша без вызова Claude', async () => {
    const item = makeItem();
    const hash = createHash('sha256').update(item.rawNote).digest('hex');
    const anthropic = makeAnthropicMock({ items: [] });
    const { service, saveSpy } = makeService({
      anthropic,
      cacheRows: [
        {
          noteHash: hash,
          explanation: {
            summary: 'cached summary',
            regulation: 'ТР ТС 020/2011',
            form: 'declaration',
            authority: 'Минпромторг России',
          } as never,
          fetchedAt: new Date(),
        },
      ],
    });
    const result = await service.explain([item]);
    expect(result.fromDbCache).toBe(1);
    expect(result.fromClaude).toBe(0);
    expect(result.byId.get(item.id)?.summary).toBe('cached summary');
    expect(anthropic.messages.create).not.toHaveBeenCalled();
    expect(saveSpy).not.toHaveBeenCalled();
  });

  it('вызывает Claude для нового NOTE и кэширует ответ в БД', async () => {
    const item = makeItem();
    const anthropic = makeAnthropicMock({
      items: [
        {
          id: item.id,
          summary: 'AI-расширенная сводка про ТР ТС 020/2011',
          regulation: 'ТР ТС 020/2011',
          form: 'declaration',
          authority: 'Минпромторг России',
        },
      ],
    });
    const { service, saveSpy, usageLog } = makeService({ anthropic });
    const result = await service.explain([item]);
    expect(result.fromClaude).toBe(1);
    expect(result.byId.size).toBe(1);
    expect(result.byId.get(item.id)?.summary).toContain('ТР ТС 020/2011');
    expect(saveSpy).toHaveBeenCalledTimes(1);
    expect(usageLog).toHaveBeenCalledWith(
      expect.objectContaining({ purpose: 'regulatory_interpret' }),
    );
  });

  it('склеивает несколько items с одинаковым NOTE в один запрос Claude', async () => {
    const itemA = makeItem({ id: 'aaaa1111aaaa1111' });
    const itemB = makeItem({ id: 'bbbb2222bbbb2222', priznak: 14, category: 'permit_import' });
    const anthropic = makeAnthropicMock({
      items: [
        {
          id: itemA.id,
          summary: 'единая выжимка',
          regulation: 'ТР ТС 020/2011',
          form: 'declaration',
        },
      ],
    });
    const { service } = makeService({ anthropic });
    const result = await service.explain([itemA, itemB]);
    expect(anthropic.messages.create).toHaveBeenCalledTimes(1);
    expect(result.byId.size).toBe(2);
    expect(result.byId.get(itemA.id)?.summary).toBe('единая выжимка');
    expect(result.byId.get(itemB.id)?.summary).toBe('единая выжимка');
  });

  it('игнорирует invalid form value из ответа Claude', async () => {
    const item = makeItem();
    const anthropic = makeAnthropicMock({
      items: [{ id: item.id, summary: 'ok', form: 'bogus_form_value' as never }],
    });
    const { service } = makeService({ anthropic });
    const result = await service.explain([item]);
    expect(result.byId.get(item.id)?.form).toBeNull();
  });
});
