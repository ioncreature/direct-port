import { createHash } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { TksApiClient, type TnvedCode } from '@direct-port/tks-api';
import { buildRateFields } from '../classifier/classification-assembler';
import type { ClassifiedProduct, ProductRow } from '../classifier/classifier.service';
import { errMsg } from '../common/errors';
import { getStaticNoteTranslation } from '../common/note-translations';
import type { ProductAttributes } from '../common/product-attributes';
import type { ProductNote } from '../common/product-notes';
import {
  ClientProductCode,
  type ClientProductCodeSource,
} from '../database/entities/client-product-code.entity';
import type { Document } from '../database/entities/document.entity';

/** Параллелизм загрузки TNVED из TKS — тот же предел, что у classifier.loadTnvedRates. */
const TKS_CONCURRENCY = 5;

/** Размер чанка multi-row upsert'а каталога (8 параметров на строку). */
const UPSERT_CHUNK = 200;

/** Строка resultData в части, нужной для записи в каталог. */
interface ResultRowLike {
  description?: unknown;
  attributes?: unknown;
  tnVedCode?: unknown;
  matched?: unknown;
  matchConfidence?: unknown;
  verificationStatus?: unknown;
  codeSource?: unknown;
}

/**
 * Каталог подтверждённых кодов ТН ВЭД клиента — «память» об ассортименте (см. entity
 * ClientProductCode). Повторная поставка тех же товаров находит код здесь и минует
 * AI-классификацию и TKS-поиск: дешевле, быстрее, и коды не расходятся между расчётами.
 *
 * Все методы best-effort: сбой каталога никогда не роняет pipeline — строка просто
 * уходит обычным путём классификации, запись в каталог молча пропускается с warn-логом.
 */
@Injectable()
export class ClientCodeCatalogService {
  private logger = new Logger(ClientCodeCatalogService.name);

  constructor(
    @InjectRepository(ClientProductCode)
    private repo: Repository<ClientProductCode>,
    private tksApi: TksApiClient,
  ) {}

  /**
   * Стабильный ключ товара между поставками: нормализованное описание + артикул.
   * Прочие атрибуты (материал, бренд…) в ключ сознательно не входят — парсер извлекает
   * их нестабильно, а «тот же товар» для повторной поставки определяют описание и артикул.
   */
  buildProductKey(description: string, attributes?: ProductAttributes): string {
    const desc = description.trim().toLowerCase().replace(/\s+/g, ' ');
    const article = (attributes?.article ?? '').trim().toLowerCase();
    return createHash('sha256').update(`${desc}|${article}`).digest('hex');
  }

  /**
   * Ищет строки документа в каталоге клиента. Возвращает массив, выровненный с rows:
   * ClassifiedProduct для хита (codeSource='catalog', ставки из TKS), null — мимо каталога.
   * Хиты минуют классификатор целиком (включая vision-retry). Недоступный TKS для кода
   * из каталога → null (строка идёт обычным путём, там свой stale-fallback и retry).
   */
  async classifyFromCatalog(
    doc: Pick<Document, 'companyId' | 'telegramUserId' | 'language'>,
    rows: ProductRow[],
  ): Promise<(ClassifiedProduct | null)[]> {
    const misses = rows.map(() => null);
    if (!doc.telegramUserId || !doc.companyId || rows.length === 0) return misses;

    try {
      const keys = rows.map((row) => this.buildProductKey(row.description, row.attributes));
      const entries = await this.repo.find({
        where: {
          companyId: doc.companyId,
          telegramUserId: doc.telegramUserId,
          productKey: In([...new Set(keys)]),
        },
      });
      if (entries.length === 0) return misses;
      const byKey = new Map(entries.map((e) => [e.productKey, e]));

      // TKS-ставки хитов: дедуп по коду + параллельные батчи (как classifier.loadTnvedRates) —
      // повторная поставка с высоким hit-rate иначе выстраивала бы сотни серийных раундтрипов.
      const hitCodes = new Set<string>();
      for (const key of keys) {
        const entry = byKey.get(key);
        if (entry) hitCodes.add(entry.tnVedCode);
      }
      const tnvedByCode = await this.loadTnvedByCode([...hitCodes]);

      const usedEntryIds = new Set<string>();
      const result = rows.map((row, i) => {
        const entry = byKey.get(keys[i]);
        const tnved = entry ? tnvedByCode.get(entry.tnVedCode) : undefined;
        if (!entry || !tnved) return null;
        usedEntryIds.add(entry.id);
        return this.buildFromEntry(row, entry, tnved, doc.language);
      });

      if (usedEntryIds.size > 0) {
        await this.repo
          .createQueryBuilder()
          .update()
          .set({ timesUsed: () => '"times_used" + 1', lastUsedAt: new Date() })
          .whereInIds([...usedEntryIds])
          .execute();
      }
      return result;
    } catch (err) {
      this.logger.warn(`Catalog lookup failed, falling back to classifier: ${errMsg(err)}`);
      return misses;
    }
  }

  /** Загрузка TNVED по уникальным кодам батчами по TKS_CONCURRENCY. Недоступный/пустой код
   *  просто отсутствует в карте — его строки уходят обычным путём классификации. */
  private async loadTnvedByCode(codes: string[]): Promise<Map<string, TnvedCode>> {
    const map = new Map<string, TnvedCode>();
    for (let i = 0; i < codes.length; i += TKS_CONCURRENCY) {
      const batch = codes.slice(i, i + TKS_CONCURRENCY);
      await Promise.all(
        batch.map(async (code) => {
          try {
            const tnved = await this.tksApi.getTnvedCode(code);
            if (tnved?.CODE) map.set(code, tnved);
          } catch (err) {
            this.logger.warn(`Catalog code ${code} TKS lookup failed: ${errMsg(err)}`);
          }
        }),
      );
    }
    return map;
  }

  /**
   * Записывает подтверждённые коды успешно обработанного документа (source='auto').
   * Берутся только строки verificationStatus='exact' с кодом от классификатора
   * (codeSource='ai'): хиты каталога уже в нём, ручные коды пишет recordManualCode.
   * Вызывается best-effort после финального статуса — сбой только логируется.
   */
  async recordFromResult(doc: Document): Promise<void> {
    if (!doc.telegramUserId || !doc.companyId || !Array.isArray(doc.resultData)) return;
    try {
      const rows = doc.resultData as ResultRowLike[];
      const confirmed = rows.filter(
        (row) =>
          row.matched === true &&
          row.verificationStatus === 'exact' &&
          (row.codeSource ?? 'ai') === 'ai' &&
          typeof row.tnVedCode === 'string' &&
          row.tnVedCode.length > 0 &&
          typeof row.description === 'string' &&
          row.description.trim().length > 0,
      );
      const items = confirmed.map((row) => ({
        companyId: doc.companyId as string,
        telegramUserId: doc.telegramUserId as string,
        description: String(row.description),
        attributes: (row.attributes ?? undefined) as ProductAttributes | undefined,
        tnVedCode: String(row.tnVedCode),
        matchConfidence: Number(row.matchConfidence) || 0,
        source: 'auto' as const,
      }));
      await this.upsertMany(items);
      if (items.length > 0) {
        this.logger.log(
          `Catalog: recorded ${items.length} confirmed codes for client ${doc.telegramUserId}`,
        );
      }
    } catch (err) {
      this.logger.warn(`Catalog record failed for document ${doc.id}: ${errMsg(err)}`);
    }
  }

  /** Ручной выбор кода оператором — самый доверенный источник (source='manual'). */
  async recordManualCode(
    doc: Pick<Document, 'id' | 'companyId' | 'telegramUserId'>,
    row: { description: string; attributes?: ProductAttributes },
    tnVedCode: string,
  ): Promise<void> {
    if (!doc.telegramUserId || !doc.companyId || !row.description.trim()) return;
    try {
      await this.upsertMany([
        {
          companyId: doc.companyId,
          telegramUserId: doc.telegramUserId,
          description: row.description,
          attributes: row.attributes,
          tnVedCode,
          matchConfidence: 1,
          source: 'manual',
        },
      ]);
    } catch (err) {
      this.logger.warn(`Catalog manual record failed for document ${doc.id}: ${errMsg(err)}`);
    }
  }

  private buildFromEntry(
    row: ProductRow,
    entry: ClientProductCode,
    tnved: TnvedCode,
    language: string | null | undefined,
  ): ClassifiedProduct {
    const sourceLabel =
      entry.source === 'manual'
        ? 'подтверждён оператором'
        : 'уверенная классификация предыдущего расчёта';
    const note: ProductNote = {
      stage: 'classify',
      severity: 'info',
      field: 'code',
      message: `Код ${tnved.CODE} взят из каталога подтверждённых кодов клиента (${sourceLabel}).`,
      messageLocalized: getStaticNoteTranslation('catalog-code', language ?? undefined),
    };

    return {
      ...row,
      // Единый источник rate-полей (включая supplementaryUnit) с pipeline-сборкой.
      ...buildRateFields(tnved),
      matchConfidence: entry.source === 'manual' ? 1 : entry.matchConfidence,
      matched: true,
      tnvedRaw: tnved,
      verified: true,
      suggestedCode: null,
      verificationComment: `Код из каталога клиента (${sourceLabel})`,
      notes: [...(row.notes ?? []), note],
      codeSource: 'catalog',
    };
  }

  /**
   * Батч-upsert по (company, client, key): один multi-row INSERT на чанк вместо
   * раундтрипа на строку. manual не понижается до auto. Дубли productKey внутри
   * батча схлопываются (последний побеждает) — иначе ON CONFLICT падает на
   * «cannot affect row a second time».
   */
  private async upsertMany(
    items: Array<{
      companyId: string;
      telegramUserId: string;
      description: string;
      attributes?: ProductAttributes;
      tnVedCode: string;
      matchConfidence: number;
      source: ClientProductCodeSource;
    }>,
  ): Promise<void> {
    const byKey = new Map(
      items.map((item) => [this.buildProductKey(item.description, item.attributes), item]),
    );
    const rows = [...byKey.entries()];
    for (let i = 0; i < rows.length; i += UPSERT_CHUNK) {
      const chunk = rows.slice(i, i + UPSERT_CHUNK);
      const params: unknown[] = [];
      const values = chunk
        .map(([productKey, item]) => {
          params.push(
            item.companyId,
            item.telegramUserId,
            productKey,
            item.description,
            item.attributes?.article ?? null,
            item.tnVedCode,
            item.source,
            item.matchConfidence,
          );
          const p = params.length;
          return `($${p - 7}, $${p - 6}, $${p - 5}, $${p - 4}, $${p - 3}, $${p - 2}, $${p - 1}, $${p})`;
        })
        .join(', ');
      await this.repo.query(
        `INSERT INTO "client_product_codes"
           ("company_id", "telegram_user_id", "product_key", "description", "article",
            "tn_ved_code", "source", "match_confidence")
         VALUES ${values}
         ON CONFLICT ("company_id", "telegram_user_id", "product_key") DO UPDATE SET
           "tn_ved_code" = EXCLUDED."tn_ved_code",
           "source" = EXCLUDED."source",
           "match_confidence" = EXCLUDED."match_confidence",
           "description" = EXCLUDED."description",
           "article" = EXCLUDED."article",
           "updated_at" = now()
         WHERE "client_product_codes"."source" != 'manual' OR EXCLUDED."source" = 'manual'`,
        params,
      );
    }
  }
}
