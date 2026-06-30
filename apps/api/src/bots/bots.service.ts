import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SecretCipher } from '../common/crypto/secret-cipher';
import { Company } from '../database/entities/company.entity';

export type BotKind = 'client' | 'manager';

export interface BotDescriptor {
  companyId: string;
  /** Расшифрованный токен Telegram-бота. */
  token: string;
}

/**
 * Источник правды о ботах компаний для реестров client-bot / manager-bot. Отдаёт компании, у
 * которых задан токен соответствующего бота, с расшифрованным токеном. Дефолтный (env) бот в
 * список НЕ входит — его поднимает сам бот из собственного TELEGRAM_BOT_TOKEN. См. docs/COMPANY_BOTS.md.
 */
@Injectable()
export class BotsService {
  private logger = new Logger(BotsService.name);

  constructor(
    @InjectRepository(Company) private companiesRepo: Repository<Company>,
    private cipher: SecretCipher,
  ) {}

  async listBots(kind: BotKind): Promise<BotDescriptor[]> {
    const tokenField = kind === 'client' ? 'clientBotTokenEnc' : 'managerBotTokenEnc';
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
        result.push({
          companyId: row.companyId,
          token: this.cipher.decrypt(row.tokenEnc),
        });
      } catch (err) {
        // Битый/нерасшифровываемый токен (сменили ключ, повреждение) не валит весь список —
        // остальные боты компании поднимутся, проблемный — пропускаем с логом.
        this.logger.error(
          `Failed to decrypt ${kind} bot token for company ${row.companyId}: ${(err as Error).message}`,
        );
      }
    }
    return result;
  }
}
