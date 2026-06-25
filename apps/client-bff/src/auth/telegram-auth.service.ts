import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { TelegramLoginDto } from './dto/telegram-login.dto';

/**
 * Верификация данных Telegram Login Widget.
 * Алгоритм (docs Telegram): secret = SHA256(bot_token); проверяем
 * hash == HMAC_SHA256(data_check_string, secret), где data_check_string —
 * все полученные поля кроме hash, в виде `key=value`, отсортированные по ключу,
 * через `\n`. Дополнительно — свежесть auth_date (анти-replay).
 *
 * Виджет привязан к client-bot, поэтому TELEGRAM_BOT_TOKEN — токен client-bot.
 */
@Injectable()
export class TelegramAuthService {
  private logger = new Logger(TelegramAuthService.name);
  private readonly botToken: string;
  private readonly maxAgeSeconds: number;

  constructor(config: ConfigService) {
    this.botToken = config.get<string>('TELEGRAM_BOT_TOKEN', '');
    this.maxAgeSeconds = Number(config.get('TELEGRAM_AUTH_MAX_AGE_SECONDS', '86400'));
  }

  /** true — подпись верна и auth_date свежий. Fail-closed: нет токена → false. */
  verify(data: TelegramLoginDto): boolean {
    if (!this.botToken) {
      this.logger.error('TELEGRAM_BOT_TOKEN is not set — cannot verify Telegram login');
      return false;
    }

    const { hash, ...fields } = data;
    if (!hash) return false;

    const dataCheckString = Object.entries(fields)
      .filter(([, v]) => v !== undefined && v !== null)
      .map(([k, v]) => [k, String(v)] as const)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, v]) => `${k}=${v}`)
      .join('\n');

    const secret = createHash('sha256').update(this.botToken).digest();
    const computed = createHmac('sha256', secret).update(dataCheckString).digest('hex');

    if (!this.safeEqualHex(computed, hash)) return false;

    const ageSeconds = Math.floor(Date.now() / 1000) - data.auth_date;
    if (ageSeconds > this.maxAgeSeconds || ageSeconds < -this.maxAgeSeconds) {
      this.logger.warn(`Rejected Telegram login: auth_date is stale (age ${ageSeconds}s)`);
      return false;
    }
    return true;
  }

  /** Constant-time сравнение hex-строк; кривой hash (нечётная длина и т.п.) → false. */
  private safeEqualHex(a: string, b: string): boolean {
    if (!/^[0-9a-fA-F]+$/.test(b) || a.length !== b.length) return false;
    const bufA = Buffer.from(a, 'hex');
    const bufB = Buffer.from(b, 'hex');
    return bufA.length === bufB.length && timingSafeEqual(bufA, bufB);
  }
}
