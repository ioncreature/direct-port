import { HttpException } from '@nestjs/common';
import { AppController } from './app.controller';

function make(dbOk: boolean, redisOk: boolean) {
  const dataSource = {
    query: jest.fn(() =>
      dbOk ? Promise.resolve([{ ok: 1 }]) : Promise.reject(new Error('db down')),
    ),
  };
  const redis = {
    ping: jest.fn(() => (redisOk ? Promise.resolve('PONG') : Promise.reject(new Error('redis down')))),
  };
  return { controller: new AppController(dataSource as never, redis as never), dataSource, redis };
}

describe('AppController', () => {
  it('liveness → ok, БД/Redis не трогаются (кратковременный сбой не должен рестартовать под)', () => {
    const { controller, dataSource, redis } = make(true, true);
    expect(controller.liveness()).toEqual({ status: 'ok' });
    expect(dataSource.query).not.toHaveBeenCalled();
    expect(redis.ping).not.toHaveBeenCalled();
  });

  it('readiness → ok при живых Postgres и Redis', async () => {
    const { controller } = make(true, true);
    await expect(controller.readiness()).resolves.toEqual({ status: 'ok', db: true, redis: true });
  });

  it('readiness → 503 при недоступной БД', async () => {
    const { controller } = make(false, true);
    await expect(controller.readiness()).rejects.toBeInstanceOf(HttpException);
  });

  it('readiness → 503 при недоступном Redis', async () => {
    const { controller } = make(true, false);
    await expect(controller.readiness()).rejects.toBeInstanceOf(HttpException);
  });
});
