import { ExecutionContext, HttpException } from '@nestjs/common';
import { AuthThrottleGuard } from './auth-throttle.guard';

function ctx(req: Record<string, unknown>): ExecutionContext {
  return { switchToHttp: () => ({ getRequest: () => req }) } as unknown as ExecutionContext;
}

function req(over: Record<string, unknown> = {}): Record<string, unknown> {
  return { path: '/api/auth/login', ip: '1.2.3.4', headers: {}, body: {}, ...over };
}

/**
 * Redis-мок под pipeline().incr().expire().exec() из fixedWindowHit.
 * counts — ответы INCR по порядку вызовов; 'down' — Redis недоступен (exec отклоняется).
 */
function makeRedis(...counts: Array<number | 'down'>) {
  const incrKeys: string[] = [];
  const expireArgs: unknown[][] = [];
  let call = 0;
  const pipeline = jest.fn(() => {
    const p = {
      incr: (key: string) => {
        incrKeys.push(key);
        return p;
      },
      expire: (...args: unknown[]) => {
        expireArgs.push(args);
        return p;
      },
      exec: () => {
        const count = counts[call++];
        return count === 'down'
          ? Promise.reject(new Error('down'))
          : Promise.resolve([
              [null, count],
              [null, 1],
            ]);
      },
    };
    return p;
  });
  return { pipeline, incrKeys, expireArgs };
}

describe('AuthThrottleGuard', () => {
  const OLD = process.env.AUTH_RATE_MAX;
  afterEach(() => {
    if (OLD === undefined) delete process.env.AUTH_RATE_MAX;
    else process.env.AUTH_RATE_MAX = OLD;
  });

  const make = (redis: unknown) => new AuthThrottleGuard(redis as never);

  it('в пределах лимита → пропускает, TTL через EXPIRE NX', async () => {
    process.env.AUTH_RATE_MAX = '5';
    const redis = makeRedis(1);
    await expect(make(redis).canActivate(ctx(req()))).resolves.toBe(true);
    expect(redis.expireArgs[0]).toEqual([expect.any(String), 300, 'NX']);
  });

  it('превышение лимита по IP → 429', async () => {
    process.env.AUTH_RATE_MAX = '2';
    const redis = makeRedis(3);
    await expect(make(redis).canActivate(ctx(req()))).rejects.toBeInstanceOf(HttpException);
  });

  it('лимит=0 → выключен, Redis не трогается', async () => {
    process.env.AUTH_RATE_MAX = '0';
    const redis = makeRedis(1);
    await expect(make(redis).canActivate(ctx(req()))).resolves.toBe(true);
    expect(redis.pipeline).not.toHaveBeenCalled();
  });

  it('недоступный Redis → fail-open (вход не блокируется всем сразу)', async () => {
    process.env.AUTH_RATE_MAX = '5';
    const redis = makeRedis('down');
    await expect(make(redis).canActivate(ctx(req()))).resolves.toBe(true);
  });

  it('IP берётся из cf-connecting-ip (доверенный хоп), спуфимый X-Forwarded-For игнорируется', async () => {
    process.env.AUTH_RATE_MAX = '5';
    const redis = makeRedis(1);
    await make(redis).canActivate(
      ctx(
        req({
          headers: {
            'cf-connecting-ip': '9.9.9.9',
            // Первый элемент XFF — клиентский заголовок: ротация фейков обнуляла бы лимит.
            'x-forwarded-for': '6.6.6.6, 9.9.9.9',
          },
        }),
      ),
    );
    expect(redis.incrKeys[0]).toContain(':ip:9.9.9.9');
    expect(redis.incrKeys[0]).not.toContain('6.6.6.6');
    expect(redis.incrKeys[0]).toContain('/api/auth/login');
  });

  it('без Cloudflare (dev/локалка) → req.ip, XFF по-прежнему не читается', async () => {
    process.env.AUTH_RATE_MAX = '5';
    const redis = makeRedis(1);
    await make(redis).canActivate(ctx(req({ headers: { 'x-forwarded-for': '6.6.6.6' } })));
    expect(redis.incrKeys[0]).toContain(':ip:1.2.3.4');
  });

  it('второе измерение: email из body даёт отдельный id-ключ с хэшем (без PII в Redis)', async () => {
    process.env.AUTH_RATE_MAX = '5';
    const redis = makeRedis(1, 1);
    await make(redis).canActivate(ctx(req({ body: { email: 'Admin@DirectPort.ru' } })));
    expect(redis.incrKeys).toHaveLength(2);
    expect(redis.incrKeys[1]).toContain(':id:');
    expect(redis.incrKeys[1].toLowerCase()).not.toContain('directport'); // hash, не сырой email
  });

  it('перебор одной учётки со свежих IP → 429 по идентификаторному измерению', async () => {
    process.env.AUTH_RATE_MAX = '2';
    // IP-ключ свежий (count=1), id-ключ уже перегрет (count=3).
    const redis = makeRedis(1, 3);
    await expect(
      make(redis).canActivate(ctx(req({ body: { email: 'victim@x.ru' } }))),
    ).rejects.toBeInstanceOf(HttpException);
  });

  it('refresh: идентификатор — hash refresh-токена из body', async () => {
    process.env.AUTH_RATE_MAX = '5';
    const redis = makeRedis(1, 1);
    await make(redis).canActivate(
      ctx(req({ path: '/api/auth/refresh', body: { refreshToken: 'eyJhbGciOi...' } })),
    );
    expect(redis.incrKeys).toHaveLength(2);
    expect(redis.incrKeys[1]).toContain('/api/auth/refresh:id:');
  });
});
