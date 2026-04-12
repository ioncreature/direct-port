import { ConfigService } from '@nestjs/config';
import { Repository } from 'typeorm';
import { TksCache } from '../database/entities/tks-cache.entity';
import { PgTksCacheStore } from './pg-tks-cache.store';

function createMockRepo(): jest.Mocked<Repository<TksCache>> {
  return {
    findOne: jest.fn(),
    delete: jest.fn(),
    clear: jest.fn(),
    createQueryBuilder: jest.fn(),
  } as any;
}

function createMockConfig(overrides: Record<string, string> = {}): ConfigService {
  return { get: (key: string) => overrides[key] ?? undefined } as any;
}

function createStore(
  repo?: jest.Mocked<Repository<TksCache>>,
  config?: Record<string, string>,
) {
  const r = repo ?? createMockRepo();
  const store = new PgTksCacheStore(r, createMockConfig(config ?? {}));
  return { store, repo: r };
}

function makeEntry(overrides: Partial<TksCache> = {}): TksCache {
  return {
    key: 'v1:/test',
    category: 'other',
    value: { data: 'test' },
    fetchedAt: new Date(),
    createdAt: new Date(),
    ...overrides,
  };
}

describe('PgTksCacheStore', () => {
  describe('get()', () => {
    it('returns value when entry is fresh', async () => {
      const { store, repo } = createStore();
      repo.findOne.mockResolvedValue(makeEntry({ fetchedAt: new Date() }));

      const result = await store.get('v1:/test');
      expect(result).toEqual({ data: 'test' });
      expect(repo.findOne).toHaveBeenCalledWith({ where: { key: 'v1:/test' } });
    });

    it('returns undefined when entry is stale', async () => {
      const { store, repo } = createStore();
      const staleDate = new Date(Date.now() - 48 * 60 * 60 * 1000); // 48h ago, other TTL = 24h
      repo.findOne.mockResolvedValue(makeEntry({ fetchedAt: staleDate }));

      const result = await store.get('v1:/test');
      expect(result).toBeUndefined();
    });

    it('returns undefined when entry does not exist', async () => {
      const { store, repo } = createStore();
      repo.findOne.mockResolvedValue(null);

      const result = await store.get('v1:/missing');
      expect(result).toBeUndefined();
    });

    it('uses goods TTL (30 days) for goods category', async () => {
      const { store, repo } = createStore();
      // 10 days ago — fresh for goods (30d TTL), stale for other (24h TTL)
      const tenDaysAgo = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
      repo.findOne.mockResolvedValue(makeEntry({
        category: 'goods',
        fetchedAt: tenDaysAgo,
      }));

      const result = await store.get('v1:/test');
      expect(result).toEqual({ data: 'test' });
    });

    it('uses tnved TTL (7 days) for tnved category', async () => {
      const { store, repo } = createStore();
      // 3 days ago — fresh for tnved (7d TTL)
      const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
      repo.findOne.mockResolvedValue(makeEntry({
        category: 'tnved',
        fetchedAt: threeDaysAgo,
      }));

      const result = await store.get('v1:/test');
      expect(result).toEqual({ data: 'test' });
    });

    it('treats tnved as stale after 7 days', async () => {
      const { store, repo } = createStore();
      const eightDaysAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);
      repo.findOne.mockResolvedValue(makeEntry({
        category: 'tnved',
        fetchedAt: eightDaysAgo,
      }));

      const result = await store.get('v1:/test');
      expect(result).toBeUndefined();
    });

    it('respects custom TTL from env', async () => {
      const { store, repo } = createStore(undefined, {
        TKS_CACHE_TTL_OTHER_MS: '3600000', // 1 hour
      });
      // 2 hours ago — stale with 1h TTL
      const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
      repo.findOne.mockResolvedValue(makeEntry({ fetchedAt: twoHoursAgo }));

      const result = await store.get('v1:/test');
      expect(result).toBeUndefined();
    });
  });

  describe('getStale()', () => {
    it('returns value regardless of age', async () => {
      const { store, repo } = createStore();
      const veryOld = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000);
      repo.findOne.mockResolvedValue(makeEntry({ fetchedAt: veryOld }));

      const result = await store.getStale('v1:/test');
      expect(result).toEqual({ data: 'test' });
    });

    it('returns undefined when entry does not exist', async () => {
      const { store, repo } = createStore();
      repo.findOne.mockResolvedValue(null);

      const result = await store.getStale('v1:/missing');
      expect(result).toBeUndefined();
    });

    it('uses cached stale value from prior get() without extra DB query', async () => {
      const { store, repo } = createStore();
      const staleDate = new Date(Date.now() - 48 * 60 * 60 * 1000);
      repo.findOne.mockResolvedValue(makeEntry({ fetchedAt: staleDate }));

      // get() returns undefined (stale) but caches the value
      await store.get('v1:/test');
      expect(repo.findOne).toHaveBeenCalledTimes(1);

      // getStale() returns the cached value without a second query
      const result = await store.getStale('v1:/test');
      expect(result).toEqual({ data: 'test' });
      expect(repo.findOne).toHaveBeenCalledTimes(1); // no additional call
    });

    it('falls back to DB when no cached stale value', async () => {
      const { store, repo } = createStore();
      repo.findOne.mockResolvedValue(makeEntry());

      const result = await store.getStale('v1:/other-key');
      expect(result).toEqual({ data: 'test' });
      expect(repo.findOne).toHaveBeenCalledWith({ where: { key: 'v1:/other-key' } });
    });
  });

  describe('set()', () => {
    it('calls upsert with correct category for goods key', async () => {
      const { store, repo } = createStore();
      const mockQb = {
        insert: jest.fn().mockReturnThis(),
        into: jest.fn().mockReturnThis(),
        values: jest.fn().mockReturnThis(),
        orUpdate: jest.fn().mockReturnThis(),
        execute: jest.fn().mockResolvedValue({}),
      };
      repo.createQueryBuilder.mockReturnValue(mockQb as any);

      await store.set('v1:/goods.json/json/key/?searchstr=test', { results: [] }, 0);

      expect(mockQb.values).toHaveBeenCalledWith(
        expect.objectContaining({ category: 'goods' }),
      );
    });

    it('detects tnved category for 10-digit code keys', async () => {
      const { store, repo } = createStore();
      const mockQb = {
        insert: jest.fn().mockReturnThis(),
        into: jest.fn().mockReturnThis(),
        values: jest.fn().mockReturnThis(),
        orUpdate: jest.fn().mockReturnThis(),
        execute: jest.fn().mockResolvedValue({}),
      };
      repo.createQueryBuilder.mockReturnValue(mockQb as any);

      await store.set('v1:/tnved.json/json/key/0201100001.json', { CODE: '0201100001' }, 0);

      expect(mockQb.values).toHaveBeenCalledWith(
        expect.objectContaining({ category: 'tnved' }),
      );
    });

    it('detects reference category for oksmt', async () => {
      const { store, repo } = createStore();
      const mockQb = {
        insert: jest.fn().mockReturnThis(),
        into: jest.fn().mockReturnThis(),
        values: jest.fn().mockReturnThis(),
        orUpdate: jest.fn().mockReturnThis(),
        execute: jest.fn().mockResolvedValue({}),
      };
      repo.createQueryBuilder.mockReturnValue(mockQb as any);

      await store.set('v1:/tnved.json/json/key/oksmt.json', [], 0);

      expect(mockQb.values).toHaveBeenCalledWith(
        expect.objectContaining({ category: 'reference' }),
      );
    });

    it('defaults to other category for unknown keys', async () => {
      const { store, repo } = createStore();
      const mockQb = {
        insert: jest.fn().mockReturnThis(),
        into: jest.fn().mockReturnThis(),
        values: jest.fn().mockReturnThis(),
        orUpdate: jest.fn().mockReturnThis(),
        execute: jest.fn().mockResolvedValue({}),
      };
      repo.createQueryBuilder.mockReturnValue(mockQb as any);

      await store.set('v1:/some/unknown/path', {}, 0);

      expect(mockQb.values).toHaveBeenCalledWith(
        expect.objectContaining({ category: 'other' }),
      );
    });

    it('uses orUpdate for upsert behavior', async () => {
      const { store, repo } = createStore();
      const mockQb = {
        insert: jest.fn().mockReturnThis(),
        into: jest.fn().mockReturnThis(),
        values: jest.fn().mockReturnThis(),
        orUpdate: jest.fn().mockReturnThis(),
        execute: jest.fn().mockResolvedValue({}),
      };
      repo.createQueryBuilder.mockReturnValue(mockQb as any);

      await store.set('v1:/test', { data: 1 }, 0);

      expect(mockQb.orUpdate).toHaveBeenCalledWith(
        ['value', 'category', 'fetched_at'],
        ['key'],
      );
    });
  });

  describe('delete()', () => {
    it('deletes by key', async () => {
      const { store, repo } = createStore();
      await store.delete('v1:/test');
      expect(repo.delete).toHaveBeenCalledWith({ key: 'v1:/test' });
    });
  });

  describe('clear()', () => {
    it('clears all entries', async () => {
      const { store, repo } = createStore();
      await store.clear();
      expect(repo.clear).toHaveBeenCalled();
    });
  });

  describe('category detection', () => {
    it.each([
      ['v1:/goods.json/json/k/?searchstr=test&group=code', 'goods'],
      ['v1:/goods.json/json/k/?searchstr=чайник&group=code&page=1', 'goods'],
      ['v1:/tnved.json/json/k/0201100001.json', 'tnved'],
      ['v1:/tnved.json/json/k/8516101000.json', 'tnved'],
      ['v1:/tnved.json/json/k/oksmt.json', 'reference'],
      ['v1:/tnved.json/json/k/ek_ar.json', 'reference'],
      ['v1:/tnved.json/json/k/ver.json', 'other'],
      ['v1:/tnved.json/json/k/', 'other'],
    ])('classifies "%s" as "%s"', async (key, expectedCategory) => {
      const { store, repo } = createStore();
      const mockQb = {
        insert: jest.fn().mockReturnThis(),
        into: jest.fn().mockReturnThis(),
        values: jest.fn().mockReturnThis(),
        orUpdate: jest.fn().mockReturnThis(),
        execute: jest.fn().mockResolvedValue({}),
      };
      repo.createQueryBuilder.mockReturnValue(mockQb as any);

      await store.set(key, {}, 0);

      expect(mockQb.values).toHaveBeenCalledWith(
        expect.objectContaining({ category: expectedCategory }),
      );
    });
  });
});
