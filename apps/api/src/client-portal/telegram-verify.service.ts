import { Injectable, Logger, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { Repository } from 'typeorm';
import { SecretCipher } from '../common/crypto/secret-cipher';
import { DEFAULT_COMPANY_ID } from '../common/tenant/actor-context';
import { Company } from '../database/entities/company.entity';
import { VerifyTelegramDto } from './dto/verify-telegram.dto';

/** Публичная инфа компании для рендера виджета входа в кабинете (pre-login). */
export interface CompanyPublicInfo {
  companyId: string;
  name: string;
  clientBotUsername: string | null;
}

/**
 * Резолв компании по slug и верификация подписи Telegram Login Widget для личного кабинета
 * (см. docs/COMPANY_BOTS.md, Фаза 4). Подпись проверяется токеном client-bot ИМЕННО той компании,
 * чьим виджетом залогинился клиент: подделать вход в чужую компанию нельзя — корректную подпись
 * может поставить только бот этой компании.
 *
 * Верификация живёт здесь (api), а не в client-bff: только api владеет токенами ботов
 * (SecretCipher + companies.client_bot_token_enc) и не нарушает правило «BFF без секретов и БД».
 * Алгоритм — стандартный Telegram: secret = SHA256(token); hash == HMAC_SHA256(data_check_string,
 * secret), где data_check_string — поля виджета (кроме hash) `key=value`, отсортированные по ключу,
 * через `\n`; плюс свежесть auth_date (анти-replay).
 */
@Injectable()
export class TelegramVerifyService {
  private logger = new Logger(TelegramVerifyService.name);
  private readonly defaultBotToken: string;
  private readonly maxAgeSeconds: number;

  constructor(
    @InjectRepository(Company) private companiesRepo: Repository<Company>,
    private cipher: SecretCipher,
    config: ConfigService,
  ) {
    // Токен дефолтного client-bot (env): им верифицируются логины дефолтной компании и компаний
    // без своего бота — так же, как реестр ботов даёт приоритет env-токену для дефолтной компании.
    this.defaultBotToken = config.get<string>('TELEGRAM_BOT_TOKEN', '');
    this.maxAgeSeconds = Number(config.get('TELEGRAM_AUTH_MAX_AGE_SECONDS', '86400'));
  }

  /** Публичная инфа компании для виджета входа. Нет slug → дефолтная компания. */
  async resolveCompany(slug?: string): Promise<CompanyPublicInfo> {
    const company = await this.loadCompany(slug);
    return {
      companyId: company.id,
      name: company.name,
      clientBotUsername: company.clientBotUsername,
    };
  }

  /** Верификация подписи токеном client-bot компании (по slug; нет slug → дефолтная). */
  async verify(dto: VerifyTelegramDto): Promise<{ verified: true; companyId: string }> {
    const { slug, hash, ...fields } = dto;
    const company = await this.loadCompany(slug, true);
    const token = this.resolveToken(company);
    if (!token) {
      this.logger.error(`No client-bot token for company ${company.id} — cannot verify login`);
      throw new UnauthorizedException('Telegram login verification unavailable');
    }
    if (!this.isSignatureValid(fields, hash, token)) {
      throw new UnauthorizedException('Invalid Telegram login signature');
    }
    return { verified: true, companyId: company.id };
  }

  /** Компания по slug (нет slug → дефолтная). withToken — подгрузить select:false токен. */
  private async loadCompany(slug: string | undefined, withToken = false): Promise<Company> {
    const qb = this.companiesRepo.createQueryBuilder('c');
    if (withToken) qb.addSelect('c.clientBotTokenEnc');
    if (slug) qb.where('c.slug = :slug', { slug });
    else qb.where('c.id = :id', { id: DEFAULT_COMPANY_ID });
    const company = await qb.getOne();
    if (!company) throw new NotFoundException('Company not found');
    return company;
  }

  /** Токен по правилу реестра: дефолт/без своего токена → env; иначе расшифрованный токен компании. */
  private resolveToken(company: Company): string {
    if (company.id === DEFAULT_COMPANY_ID || !company.clientBotTokenEnc) {
      return this.defaultBotToken;
    }
    return this.cipher.decrypt(company.clientBotTokenEnc);
  }

  /** true — подпись верна и auth_date свежий. */
  private isSignatureValid(fields: Record<string, unknown>, hash: string, token: string): boolean {
    if (!hash) return false;

    const dataCheckString = Object.entries(fields)
      .filter(([, v]) => v !== undefined && v !== null)
      .map(([k, v]) => [k, String(v)] as const)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, v]) => `${k}=${v}`)
      .join('\n');

    const secret = createHash('sha256').update(token).digest();
    const computed = createHmac('sha256', secret).update(dataCheckString).digest('hex');
    if (!this.safeEqualHex(computed, hash)) return false;

    const ageSeconds = Math.floor(Date.now() / 1000) - Number(fields.auth_date);
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
