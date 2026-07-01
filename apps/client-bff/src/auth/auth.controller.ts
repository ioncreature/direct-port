import { Body, Controller, Get, HttpCode, HttpStatus, Post, Query } from '@nestjs/common';
import { ApiClientService } from '../api-client/api-client.service';
import { ClientTokenService } from './client-token.service';
import { RefreshDto } from './dto/refresh.dto';
import { TelegramLoginDto } from './dto/telegram-login.dto';

/**
 * Вход в кабинет (без гарда — это и есть точка получения сессии). Telegram Login → верификация
 * подписи в api (токеном client-bot компании по slug) → резолв клиента в api → выдача client-JWT.
 * Сам BFF секретов не держит: и верификация, и резолв — это вызовы api по X-Internal-Key.
 */
@Controller('client')
export class AuthController {
  constructor(
    private tokens: ClientTokenService,
    private api: ApiClientService,
  ) {}

  /** Публичная инфа компании по slug (pre-login: чтобы client-web отрендерил виджет нужного бота). */
  @Get('company')
  company(@Query('slug') slug?: string) {
    return this.api.getCompany(slug);
  }

  @Post('auth/telegram')
  @HttpCode(HttpStatus.OK)
  async telegram(@Body() dto: TelegramLoginDto) {
    // api верифицирует подпись токеном бота компании (по slug) и возвращает её companyId;
    // невалидная подпись → api отдаёт 401 (проброс через AxiosExceptionFilter).
    const { companyId } = await this.api.verifyTelegram({ ...dto });
    const client = await this.api.resolveClient({
      companyId,
      telegramId: dto.id,
      username: dto.username,
      firstName: dto.first_name,
      lastName: dto.last_name,
    });
    const tokens = this.tokens.issueTokens({
      accountId: client.billingAccountId,
      telegramUserId: client.telegramUserId,
      name: dto.first_name ?? client.firstName,
      username: dto.username ?? client.username,
      photoUrl: dto.photo_url ?? null,
    });
    return { ...tokens, client: this.publicProfile(dto, client) };
  }

  @Post('auth/refresh')
  @HttpCode(HttpStatus.OK)
  refresh(@Body() dto: RefreshDto) {
    return this.tokens.rotate(dto.refreshToken);
  }

  private publicProfile(
    dto: TelegramLoginDto,
    client: { firstName: string | null; username: string | null },
  ) {
    return {
      name: dto.first_name ?? client.firstName,
      username: dto.username ?? client.username,
      photoUrl: dto.photo_url ?? null,
    };
  }
}
