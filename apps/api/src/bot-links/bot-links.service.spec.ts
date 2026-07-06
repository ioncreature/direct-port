import { BotLinksService } from './bot-links.service';

function createService() {
  const store = new Map<string, string>();
  const redis = {
    set: jest.fn(async (key: string, value: string) => {
      store.set(key, value);
      return 'OK';
    }),
    mget: jest.fn(async (...keys: string[]) => keys.map((k) => store.get(k) ?? null)),
  };
  // companiesRepo нужен только для getLinksForCompany; тесты дефолтных ссылок его не задействуют.
  const service = new BotLinksService(redis as never, {} as never);
  return { service, redis, store };
}

describe('BotLinksService', () => {
  it('stores identity and exposes a t.me url', async () => {
    const { service } = createService();
    await service.setIdentity('client', 'directport_client_bot');

    const links = await service.getLinks();
    expect(links.client).toMatchObject({
      username: 'directport_client_bot',
      url: 'https://t.me/directport_client_bot',
    });
    expect(links.manager).toBeNull();
  });

  it('returns null for kinds that were never published', async () => {
    const { service } = createService();
    const links = await service.getLinks();
    expect(links).toEqual({ client: null, manager: null });
  });

  it('overwrites a previously stored identity', async () => {
    const { service } = createService();
    await service.setIdentity('manager', 'old_bot');
    await service.setIdentity('manager', 'new_bot');

    const links = await service.getLinks();
    expect(links.manager?.username).toBe('new_bot');
    expect(links.manager?.url).toBe('https://t.me/new_bot');
  });

  it('ignores corrupted stored values', async () => {
    const { service, store } = createService();
    store.set('bot-link:client', '{not json');

    const links = await service.getLinks();
    expect(links.client).toBeNull();
  });
});
