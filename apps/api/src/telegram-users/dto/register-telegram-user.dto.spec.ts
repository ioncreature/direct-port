import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { DEFAULT_COMPANY_ID } from '../../common/tenant/actor-context';
import { RegisterTelegramUserDto } from './register-telegram-user.dto';

/**
 * Регресс на инцидент: client-bot дефолтной компании слал companyId = DEFAULT_COMPANY_ID
 * ('00000000-0000-0000-0000-000000000001') в /telegram-users/register, а строгий @IsUUID()
 * его отвергал (это не валидный UUID версии 1-5) → 400 → весь приём от клиентов падал.
 * Валидация companyId должна быть 'loose', чтобы принимать nil-подобный id дефолтной компании.
 */
describe('RegisterTelegramUserDto — валидация companyId', () => {
  const build = (companyId?: string) =>
    validateSync(plainToInstance(RegisterTelegramUserDto, { telegramId: 123, companyId }));

  it('принимает id дефолтной компании (nil-подобный UUID)', () => {
    expect(build(DEFAULT_COMPANY_ID)).toHaveLength(0);
  });

  it('принимает обычный UUID v4 (компания со своим ботом)', () => {
    expect(build('9f1a5b2c-3d4e-4f6a-8b9c-0d1e2f3a4b5c')).toHaveLength(0);
  });

  it('допускает отсутствие companyId (сервер подставит дефолтную)', () => {
    expect(build(undefined)).toHaveLength(0);
  });

  it('отвергает не-UUID', () => {
    const errors = build('not-a-uuid');
    expect(errors).toHaveLength(1);
    expect(errors[0].constraints).toHaveProperty('isUuid');
  });
});
