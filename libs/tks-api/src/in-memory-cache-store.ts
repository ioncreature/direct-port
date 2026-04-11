import type { TksCacheStore } from './types';

interface Entry {
  value: unknown;
  expiresAt: number;
}

/** FIFO-эвикшен при переполнении: Map сохраняет порядок вставки. */
export class InMemoryTksCacheStore implements TksCacheStore {
  private readonly map = new Map<string, Entry>();

  constructor(private readonly maxSize: number = 1000) {}

  async get<T>(key: string): Promise<T | undefined> {
    const entry = this.map.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= Date.now()) {
      this.map.delete(key);
      return undefined;
    }
    return entry.value as T;
  }

  async set<T>(key: string, value: T, ttlMs: number): Promise<void> {
    this.evictIfNeeded();
    this.map.set(key, { value, expiresAt: Date.now() + ttlMs });
  }

  async delete(key: string): Promise<void> {
    this.map.delete(key);
  }

  async clear(): Promise<void> {
    this.map.clear();
  }

  private evictIfNeeded(): void {
    if (this.map.size < this.maxSize) return;
    const now = Date.now();
    for (const [key, entry] of this.map) {
      if (entry.expiresAt <= now) this.map.delete(key);
    }
    if (this.map.size >= this.maxSize) {
      const firstKey = this.map.keys().next().value;
      if (firstKey) this.map.delete(firstKey);
    }
  }
}
