import {
  BadGatewayException,
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type Redis from 'ioredis';
import { Repository } from 'typeorm';
import { SecretCipher } from '../common/crypto/secret-cipher';
import { ErrorCode } from '../common/error-codes';
import { errMsg } from '../common/errors';
import { Company } from '../database/entities/company.entity';
import { REDIS_CLIENT } from '../redis/redis.module';
import { type BotKind } from '../bot-links/dto/publish-bot-identity.dto';
import { BOT_CONFIG_CHANNEL, type BotConfigEvent } from './bot-config-events';

export type { BotKind };

export interface BotDescriptor {
  companyId: string;
  /** Расшифрованный токен Telegram-бота. */
  token: string;
}

/** Статус ботов компании для админки (без самих токенов). */
export interface CompanyBotsStatus {
  client: { configured: boolean; username: string | null };
  manager: { configured: boolean; username: string | null };
}

/** Колонки токена/username по типу бота. */
const FIELDS: Record<BotKind, { token: keyof Company; username: keyof Company }> = {
  client: { token: 'clientBotTokenEnc', username: 'clientBotUsername' },
  manager: { token: 'managerBotTokenEnc', username: 'managerBotUsername' },
};

/**
 * Боты компаний: чтение токенов для реестров (listBots, X-Internal-Key) и self-service-управление
 * из админки (super_admin) — установка/снятие токена с валидацией через getMe, шифрованием и
 * публикацией изменения в Redis pub/sub для динамического подъёма ботов. См. docs/COMPANY_BOTS.md.
 */
@Injectable()
export class BotsService {
  private logger = new Logger(BotsService.name);

  constructor(
    @InjectRepository(Company) private companiesRepo: Repository<Company>,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private cipher: SecretCipher,
  ) {}

  /** Боты заданного типа с расшифрованными токенами — для реестра client-bot/manager-bot. */
  async listBots(kind: BotKind): Promise<BotDescriptor[]> {
    const tokenField = FIELDS[kind].token;
    // token_enc — select:false на entity, поэтому читаем явным QueryBuilder с addSelect.
    // username боту не нужен (он резолвит его сам через getMe при publishIdentity).
    const rows = await this.companiesRepo
      .createQueryBuilder('c')
      .select('c.id', 'companyId')
      .addSelect(`c.${tokenField}`, 'tokenEnc')
      .where(`c.${tokenField} IS NOT NULL`)
      .getRawMany<{ companyId: string; tokenEnc: string }>();

    const result: BotDescriptor[] = [];
    for (const row of rows) {
      try {
        result.push({ companyId: row.companyId, token: this.cipher.decrypt(row.tokenEnc) });
      } catch (err) {
        // Битый/нерасшифровываемый токен (сменили ключ, повреждение) не валит весь список —
        // остальные боты компании поднимутся, проблемный — пропускаем с логом.
        this.logger.error(`Failed to decrypt ${kind} bot token for company ${row.companyId}: ${errMsg(err)}`);
      }
    }
    return result;
  }

  /** Статус ботов компании для админки (configured + username, без токенов). */
  async getCompanyBots(companyId: string): Promise<CompanyBotsStatus> {
    const company = await this.companiesRepo
      .createQueryBuilder('c')
      .addSelect(['c.clientBotTokenEnc', 'c.managerBotTokenEnc'])
      .where('c.id = :id', { id: companyId })
      .getOne();
    if (!company) throw new NotFoundException('Company not found');
    return {
      client: { configured: company.clientBotTokenEnc != null, username: company.clientBotUsername },
      manager: {
        configured: company.managerBotTokenEnc != null,
        username: company.managerBotUsername,
      },
    };
  }

  /**
   * Установить/заменить токен бота компании: валидировать через getMe (резолв username),
   * зашифровать, сохранить, опубликовать upsert-событие для динамического подъёма бота.
   */
  async setBotToken(
    companyId: string,
    kind: BotKind,
    token: string,
  ): Promise<{ username: string }> {
    if (!this.cipher.isConfigured()) {
      throw new BadRequestException({
        code: ErrorCode.UNKNOWN_ROW,
        message: 'BOT_TOKEN_ENC_KEY is not configured — cannot store bot tokens',
      });
    }
    if (!(await this.companiesRepo.existsBy({ id: companyId }))) {
      throw new NotFoundException('Company not found');
    }
    const username = await this.resolveBotUsername(token);
    const { token: tokenField, username: usernameField } = FIELDS[kind];
    await this.companiesRepo.update(
      { id: companyId },
      { [tokenField]: this.cipher.encrypt(token), [usernameField]: username },
    );
    await this.publishEvent({ companyId, kind, action: 'upsert' });
    this.logger.log(`Set ${kind} bot for company ${companyId}: @${username}`);
    return { username };
  }

  /** Снять токен бота компании: очистить, опубликовать remove-событие (остановить бот). */
  async removeBotToken(companyId: string, kind: BotKind): Promise<void> {
    const { token: tokenField, username: usernameField } = FIELDS[kind];
    const res = await this.companiesRepo.update(
      { id: companyId },
      { [tokenField]: null, [usernameField]: null },
    );
    if (!res.affected) throw new NotFoundException('Company not found');
    await this.publishEvent({ companyId, kind, action: 'remove' });
    this.logger.log(`Removed ${kind} bot for company ${companyId}`);
  }

  /** Резолвит username бота через Telegram getMe; невалидный токен → 400, недоступность → 502. */
  private async resolveBotUsername(token: string): Promise<string> {
    let res: Response;
    try {
      res = await fetch(`https://api.telegram.org/bot${token}/getMe`, {
        signal: AbortSignal.timeout(10_000),
      });
    } catch (err) {
      throw new BadGatewayException(`Telegram API unreachable: ${errMsg(err)}`);
    }
    const data = (await res.json().catch(() => null)) as
      | { ok?: boolean; result?: { username?: string } }
      | null;
    const username = data?.ok ? data.result?.username : undefined;
    if (!username) {
      throw new BadRequestException({
        code: ErrorCode.UNKNOWN_ROW,
        message: 'Invalid bot token (Telegram getMe rejected it)',
      });
    }
    return username;
  }

  /** Best-effort publish: недоступный Redis не валит сохранение — реестр догонит реконсайлом. */
  private async publishEvent(event: BotConfigEvent): Promise<void> {
    try {
      await this.redis.publish(BOT_CONFIG_CHANNEL, JSON.stringify(event));
    } catch (err) {
      this.logger.warn(`Failed to publish bot-config event: ${errMsg(err)}`);
    }
  }
}
