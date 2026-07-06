import { NotFoundException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, createHmac } from 'node:crypto';
import { Repository } from 'typeorm';
import { SecretCipher } from '../common/crypto/secret-cipher';
import { DEFAULT_COMPANY_ID } from '../common/tenant/actor-context';
import { Company } from '../database/entities/company.entity';
import { TelegramVerifyService } from './telegram-verify.service';
import { VerifyTelegramDto } from './dto/verify-telegram.dto';

const DEFAULT_TOKEN = '111:default-bot-token';
const COMPANY_TOKEN = '222:company-bot-token';

/** Считает корректный hash виджета для набора полей и токена — зеркало алгоритма сервиса. */
function sign(fields: Record<string, string | number>, token: string): string {
  const dataCheckString = Object.entries(fields)
    .map(([k, v]) => [k, String(v)] as const)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join('\n');
  const secret = createHash('sha256').update(token).digest();
  return createHmac('sha256', secret).update(dataCheckString).digest('hex');
}

function freshAuthDate(): number {
  return Math.floor(Date.now() / 1000);
}

/** Сервис с замоканным репозиторием Company (getOne → company), cipher и config. */
function makeService(company: Partial<Company> | null): TelegramVerifyService {
  const qb = {
    addSelect: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    getOne: jest.fn().mockResolvedValue(company),
  };
  const repo = {
    createQueryBuilder: jest.fn().mockReturnValue(qb),
  } as unknown as Repository<Company>;
  const cipher = {
    decrypt: (enc: string) => (enc === 'ENC' ? COMPANY_TOKEN : enc),
  } as unknown as SecretCipher;
  const config = {
    get: (_key: string, def?: string) => def,
  } as unknown as ConfigService;
  return new TelegramVerifyService(repo, cipher, config);
}

function dto(fields: Record<string, string | number>, hash: string, slug?: string): VerifyTelegramDto {
  return { ...fields, hash, slug } as unknown as VerifyTelegramDto;
}

describe('TelegramVerifyService', () => {
  const fields = { id: 42, first_name: 'Ann', auth_date: freshAuthDate() };

  describe('verify (служебная дефолтная компания без своего бота)', () => {
    const defaultCompany: Partial<Company> = {
      id: DEFAULT_COMPANY_ID,
      name: 'Default',
      clientBotUsername: null,
      clientBotTokenEnc: null,
    };

    it('отклоняет вход: нет токена для верификации (env-дефолт убран)', async () => {
      const service = makeService(defaultCompany);
      const hash = sign(fields, DEFAULT_TOKEN);
      await expect(service.verify(dto(fields, hash))).rejects.toBeInstanceOf(UnauthorizedException);
    });
  });

  describe('verify (компания со своим ботом)', () => {
    const company: Partial<Company> = {
      id: 'c1c1c1c1-0000-0000-0000-000000000001',
      name: 'Acme',
      clientBotUsername: 'acme_bot',
      clientBotTokenEnc: 'ENC',
    };

    it('верифицирует подпись расшифрованным токеном компании (а не env)', async () => {
      const service = makeService(company);
      const hash = sign(fields, COMPANY_TOKEN);
      await expect(service.verify(dto(fields, hash, 'acme'))).resolves.toEqual({
        verified: true,
        companyId: company.id,
      });
    });

    it('отклоняет подпись, сделанную токеном другого (дефолтного) бота', async () => {
      const service = makeService(company);
      const hash = sign(fields, DEFAULT_TOKEN);
      await expect(service.verify(dto(fields, hash, 'acme'))).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    });

    it('отклоняет протухший auth_date', async () => {
      const service = makeService(company);
      const stale = { ...fields, auth_date: freshAuthDate() - 200_000 };
      const hash = sign(stale, COMPANY_TOKEN);
      await expect(service.verify(dto(stale, hash, 'acme'))).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    });
  });

  it('verify с неизвестным slug → NotFoundException', async () => {
    const service = makeService(null);
    const hash = sign(fields, DEFAULT_TOKEN);
    await expect(service.verify(dto(fields, hash, 'nope'))).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('resolveCompany отдаёт публичную инфу компании', async () => {
    const service = makeService({
      id: 'c1c1c1c1-0000-0000-0000-000000000001',
      name: 'Acme',
      clientBotUsername: 'acme_bot',
    });
    await expect(service.resolveCompany('acme')).resolves.toEqual({
      companyId: 'c1c1c1c1-0000-0000-0000-000000000001',
      name: 'Acme',
      clientBotUsername: 'acme_bot',
    });
  });
});
