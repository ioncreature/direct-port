import { ConfigService } from '@nestjs/config';
import { createHash, createHmac } from 'node:crypto';
import { TelegramAuthService } from './telegram-auth.service';
import { TelegramLoginDto } from './dto/telegram-login.dto';

const BOT_TOKEN = '123456:TEST_BOT_TOKEN_value';

function makeConfig(overrides: Record<string, string> = {}): ConfigService {
  const values: Record<string, string> = {
    TELEGRAM_BOT_TOKEN: BOT_TOKEN,
    TELEGRAM_AUTH_MAX_AGE_SECONDS: '86400',
    ...overrides,
  };
  return {
    get: (key: string, def?: string) => values[key] ?? def,
  } as unknown as ConfigService;
}

/** Подписывает payload по тому же алгоритму, что и Telegram. */
function sign(fields: Record<string, string | number>, token = BOT_TOKEN): string {
  const dataCheckString = Object.entries(fields)
    .map(([k, v]) => [k, String(v)] as const)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join('\n');
  const secret = createHash('sha256').update(token).digest();
  return createHmac('sha256', secret).update(dataCheckString).digest('hex');
}

function validPayload(): TelegramLoginDto {
  const fields = {
    id: 700700700,
    first_name: 'Иван',
    username: 'ivan',
    auth_date: Math.floor(Date.now() / 1000),
  };
  return { ...fields, hash: sign(fields) } as TelegramLoginDto;
}

describe('TelegramAuthService', () => {
  it('accepts a correctly signed, fresh payload', () => {
    const service = new TelegramAuthService(makeConfig());
    expect(service.verify(validPayload())).toBe(true);
  });

  it('rejects a tampered field', () => {
    const service = new TelegramAuthService(makeConfig());
    const payload = validPayload();
    payload.first_name = 'Пётр'; // изменили после подписи
    expect(service.verify(payload)).toBe(false);
  });

  it('rejects a hash signed with a different bot token', () => {
    const service = new TelegramAuthService(makeConfig());
    const fields = {
      id: 1,
      auth_date: Math.floor(Date.now() / 1000),
    };
    const payload = { ...fields, hash: sign(fields, 'other-token') } as TelegramLoginDto;
    expect(service.verify(payload)).toBe(false);
  });

  it('rejects a stale auth_date (replay window exceeded)', () => {
    const service = new TelegramAuthService(makeConfig({ TELEGRAM_AUTH_MAX_AGE_SECONDS: '60' }));
    const fields = {
      id: 1,
      auth_date: Math.floor(Date.now() / 1000) - 3600,
    };
    const payload = { ...fields, hash: sign(fields) } as TelegramLoginDto;
    expect(service.verify(payload)).toBe(false);
  });

  it('rejects a malformed (non-hex) hash', () => {
    const service = new TelegramAuthService(makeConfig());
    const payload = validPayload();
    payload.hash = 'not-a-hex-hash';
    expect(service.verify(payload)).toBe(false);
  });

  it('fails closed when the bot token is not configured', () => {
    const service = new TelegramAuthService(makeConfig({ TELEGRAM_BOT_TOKEN: '' }));
    expect(service.verify(validPayload())).toBe(false);
  });
});
