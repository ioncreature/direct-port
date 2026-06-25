import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiClientService } from '../api-client/api-client.service';
import { ClientTokenService } from './client-token.service';
import { RefreshDto } from './dto/refresh.dto';
import { TelegramLoginDto } from './dto/telegram-login.dto';
import { TelegramAuthService } from './telegram-auth.service';

/**
 * Вход в кабинет (без гарда — это и есть точка получения сессии).
 * Telegram Login → верификация подписи → резолв клиента в api → выдача client-JWT.
 */
@Controller('client/auth')
export class AuthController {
  constructor(
    private telegramAuth: TelegramAuthService,
    private tokens: ClientTokenService,
    private api: ApiClientService,
  ) {}

  @Post('telegram')
  @HttpCode(HttpStatus.OK)
  async telegram(@Body() dto: TelegramLoginDto) {
    if (!this.telegramAuth.verify(dto)) {
      throw new UnauthorizedException('Invalid Telegram login signature');
    }
    const client = await this.api.resolveClient({
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

  @Post('refresh')
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
