/**
 * Простой in-memory кэш с TTL и lazy-эвикцией по размеру. Используется
 * классификатором для двух кэшей: result-кэш classify+verify (классификация
 * того же товара тем же модельным набором не должна дёргать Claude дважды)
 * и кэш vision-retry (фото уже разобранное под тот же tnVedCode+язык не
 * перепроверяем).
 *
 * Эвикция запускается изнутри set() — когда размер превышает maxSize,
 * проходимся по карте и сносим истёкшие записи. Не LRU: nothing fancy,
 * просто чистка протухшего. В multi-replica setup кэш живёт per-pod
 * (in-memory), поэтому отдельный @Injectable не нужен — это просто
 * структура данных, инстанциируемая в полях сервиса.
 */
export const CLASSIFICATION_CACHE_TTL_MS = 86_400_000; // 24 hours
export const CLASSIFICATION_CACHE_MAX = 1000;

export class TtlMap<V> {
  private data = new Map<string, { data: V; expiresAt: number }>();

  constructor(
    private readonly ttlMs: number,
    private readonly maxSize: number,
  ) {}

  get(key: string, now: number = Date.now()): V | undefined {
    const entry = this.data.get(key);
    if (!entry || entry.expiresAt <= now) return undefined;
    return entry.data;
  }

  set(key: string, value: V, now: number = Date.now()): void {
    this.data.set(key, { data: value, expiresAt: now + this.ttlMs });
    if (this.data.size > this.maxSize) {
      for (const [k, e] of this.data) {
        if (e.expiresAt <= now) this.data.delete(k);
      }
      // Все живые, а лимит превышен — сносим старейшие записи (Map хранит порядок
      // вставки), иначе карта растёт без ограничения до конца TTL.
      if (this.data.size > this.maxSize) {
        for (const k of this.data.keys()) {
          if (this.data.size <= this.maxSize) break;
          this.data.delete(k);
        }
      }
    }
  }

  get size(): number {
    return this.data.size;
  }
}
