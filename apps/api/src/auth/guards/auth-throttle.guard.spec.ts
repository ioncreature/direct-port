import { ExecutionContext, HttpException } from '@nestjs/common';
import { AuthThrottleGuard } from './auth-throttle.guard';

function ctx(req: Record<string, unknown>): ExecutionContext {
  return { switchToHttp: () => ({ getRequest: () => req }) } as unknown as ExecutionContext;
}

function req(over: Record<string, unknown> = {}): Record<string, unknown> {
  return { path: '/api/auth/login', ip: '1.2.3.4', headers: {}, ...over };
}

describe('AuthThrottleGuard', () => {
  const OLD = process.env.AUTH_RATE_MAX;
  afterEach(() => {
    if (OLD === undefined) delete process.env.AUTH_RATE_MAX;
    else process.env.AUTH_RATE_MAX = OLD;
  });

  const make = (redis: unknown) => new AuthThrottleGuard(redis as never);

  it('в пределах лимита → пропускает, TTL ставится на первой попытке', async () => {
    process.env.AUTH_RATE_MAX = '5';
    const redis = { incr: jest.fn().mockResolvedValue(1), expire: jest.fn().mockResolvedValue(1) };
    await expect(make(redis).canActivate(ctx(req()))).resolves.toBe(true);
    expect(redis.expire).toHaveBeenCalled();
  });

  it('превышение лимита → 429', async () => {
    process.env.AUTH_RATE_MAX = '2';
    const redis = { incr: jest.fn().mockResolvedValue(3), expire: jest.fn() };
    await expect(make(redis).canActivate(ctx(req()))).rejects.toBeInstanceOf(HttpException);
  });

  it('лимит=0 → выключен, Redis не трогается', async () => {
    process.env.AUTH_RATE_MAX = '0';
    const redis = { incr: jest.fn(), expire: jest.fn() };
    await expect(make(redis).canActivate(ctx(req()))).resolves.toBe(true);
    expect(redis.incr).not.toHaveBeenCalled();
  });

  it('недоступный Redis → fail-open (вход не блокируется всем сразу)', async () => {
    process.env.AUTH_RATE_MAX = '5';
    const redis = { incr: jest.fn().mockRejectedValue(new Error('down')), expire: jest.fn() };
    await expect(make(redis).canActivate(ctx(req()))).resolves.toBe(true);
  });

  it('ключ строится по реальному IP из X-Forwarded-For и по пути (раздельные окна)', async () => {
    process.env.AUTH_RATE_MAX = '5';
    const redis = { incr: jest.fn().mockResolvedValue(1), expire: jest.fn().mockResolvedValue(1) };
    await make(redis).canActivate(
      ctx(req({ headers: { 'x-forwarded-for': '9.9.9.9, 1.1.1.1' } })),
    );
    const key = redis.incr.mock.calls[0][0] as string;
    expect(key).toContain('9.9.9.9');
    expect(key).toContain('/api/auth/login');
  });
});
