import 'reflect-metadata';
import { AuthController } from './auth.controller';
import { TelegramLoginDto } from './dto/telegram-login.dto';

const RESOLVED_CLIENT = {
  telegramUserId: 'tgu-uuid-1',
  billingAccountId: 'acc-uuid-1',
  companyId: 'company-uuid-1',
  firstName: 'Иван (из БД)',
  username: 'ivan_db',
};

function makeDto(overrides: Partial<TelegramLoginDto> = {}): TelegramLoginDto {
  return {
    slug: 'acme',
    id: 123456789,
    first_name: 'Иван',
    username: 'ivan_tg',
    photo_url: 'https://t.me/i/userpic/ivan.jpg',
    auth_date: 1752192000,
    hash: 'telegram-signature-hash',
    ...overrides,
  } as TelegramLoginDto;
}

function createController() {
  const api = {
    getCompany: jest.fn().mockResolvedValue({ companyId: 'company-uuid-1', name: 'Acme' }),
    verifyTelegram: jest.fn().mockResolvedValue({ companyId: 'company-uuid-1' }),
    resolveClient: jest.fn().mockResolvedValue(RESOLVED_CLIENT),
  };
  const tokens = {
    issueTokens: jest.fn().mockReturnValue({ accessToken: 'at', refreshToken: 'rt' }),
    rotate: jest.fn().mockReturnValue({ accessToken: 'at2', refreshToken: 'rt2' }),
  };
  return { controller: new AuthController(tokens as any, api as any), api, tokens };
}

describe('AuthController', () => {
  describe('POST /client/auth/telegram', () => {
    it('верифицирует подпись в api и выдаёт токены на id из ответа api (не из запроса)', async () => {
      const { controller, api, tokens } = createController();
      const dto = makeDto();

      const result = await controller.telegram(dto);

      // Весь виджет-payload (включая slug и hash) уходит в api на верификацию.
      expect(api.verifyTelegram).toHaveBeenCalledWith({ ...dto });
      // companyId для резолва — из ответа верификации, telegramId — из виджета.
      expect(api.resolveClient).toHaveBeenCalledWith({
        companyId: 'company-uuid-1',
        telegramId: dto.id,
        username: dto.username,
        firstName: dto.first_name,
        lastName: dto.last_name,
      });
      // В JWT попадают accountId/telegramUserId, которые вернул api (upsert),
      // а не что-либо предоставленное клиентом.
      expect(tokens.issueTokens).toHaveBeenCalledWith({
        accountId: RESOLVED_CLIENT.billingAccountId,
        telegramUserId: RESOLVED_CLIENT.telegramUserId,
        name: dto.first_name,
        username: dto.username,
        photoUrl: dto.photo_url,
      });
      expect(result).toEqual({
        accessToken: 'at',
        refreshToken: 'rt',
        client: { name: 'Иван', username: 'ivan_tg', photoUrl: dto.photo_url },
      });
    });

    it('невалидная подпись (api отверг) → ошибка пробрасывается, токены не выдаются', async () => {
      const { controller, api, tokens } = createController();
      const upstream = new Error('Request failed with status code 401');
      api.verifyTelegram.mockRejectedValue(upstream);

      await expect(controller.telegram(makeDto())).rejects.toBe(upstream);
      expect(api.resolveClient).not.toHaveBeenCalled();
      expect(tokens.issueTokens).not.toHaveBeenCalled();
    });

    it('без first_name/username в виджете берёт значения из клиента в БД', async () => {
      const { controller, tokens } = createController();
      const dto = makeDto({ first_name: undefined, username: undefined, photo_url: undefined });

      const result = await controller.telegram(dto);

      expect(tokens.issueTokens).toHaveBeenCalledWith(
        expect.objectContaining({
          name: RESOLVED_CLIENT.firstName,
          username: RESOLVED_CLIENT.username,
          photoUrl: null,
        }),
      );
      expect(result.client).toEqual({
        name: RESOLVED_CLIENT.firstName,
        username: RESOLVED_CLIENT.username,
        photoUrl: null,
      });
    });
  });

  describe('POST /client/auth/refresh', () => {
    it('делегирует ротацию ClientTokenService', () => {
      const { controller, tokens } = createController();
      const result = controller.refresh({ refreshToken: 'old-rt' });
      expect(tokens.rotate).toHaveBeenCalledWith('old-rt');
      expect(result).toEqual({ accessToken: 'at2', refreshToken: 'rt2' });
    });
  });

  describe('GET /client/company', () => {
    it('проксирует slug в api', async () => {
      const { controller, api } = createController();
      await controller.company('acme');
      expect(api.getCompany).toHaveBeenCalledWith('acme');
    });
  });
});
