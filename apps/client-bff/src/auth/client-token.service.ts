import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';

/** Профиль для отображения в кабинете (из данных Telegram Login, переносится в JWT). */
export interface ClientProfile {
  accountId: string;
  telegramUserId: string;
  name: string | null;
  username: string | null;
  photoUrl: string | null;
}

type TokenType = 'access' | 'refresh';

interface ClientTokenPayload {
  sub: string; // billingAccountId
  tgu: string; // telegramUserId
  typ: TokenType;
  name?: string | null;
  username?: string | null;
  photo?: string | null;
}

export interface IssuedTokens {
  accessToken: string;
  refreshToken: string;
}

/**
 * Выпуск и проверка client-JWT (sub = billingAccountId). Stateless: refresh — тоже
 * подписанный JWT (typ='refresh', больший TTL), отзыва нет (осознанный компромисс Ф1 —
 * BFF без БД/Redis). Профиль для дашборда переносится прямо в токен, чтобы /client/me
 * не дёргал api лишний раз и переживал refresh без потери имени.
 */
@Injectable()
export class ClientTokenService {
  constructor(
    private jwt: JwtService,
    private config: ConfigService,
  ) {}

  issueTokens(profile: ClientProfile): IssuedTokens {
    const base = {
      sub: profile.accountId,
      tgu: profile.telegramUserId,
      name: profile.name,
      username: profile.username,
      photo: profile.photoUrl,
    };
    // config.get<T = any> возвращает any — expiresIn (number | ms.StringValue) проходит,
    // как и в apps/api auth.service.
    return {
      accessToken: this.jwt.sign(
        { ...base, typ: 'access' },
        { expiresIn: this.config.get('CLIENT_JWT_ACCESS_TTL', '15m') },
      ),
      refreshToken: this.jwt.sign(
        { ...base, typ: 'refresh' },
        { expiresIn: this.config.get('CLIENT_JWT_REFRESH_TTL', '30d') },
      ),
    };
  }

  /** Проверка access-токена (для ClientAuthGuard) → принципал кабинета. */
  verifyAccess(token: string): ClientProfile {
    return this.toProfile(this.verify(token, 'access'));
  }

  /** Проверка refresh-токена и ре-выпуск пары (ротация). */
  rotate(refreshToken: string): IssuedTokens {
    const payload = this.verify(refreshToken, 'refresh');
    return this.issueTokens(this.toProfile(payload));
  }

  private verify(token: string, expected: TokenType): ClientTokenPayload {
    let payload: ClientTokenPayload;
    try {
      payload = this.jwt.verify<ClientTokenPayload>(token);
    } catch {
      throw new UnauthorizedException('Invalid or expired token');
    }
    if (payload.typ !== expected) {
      throw new UnauthorizedException('Wrong token type');
    }
    return payload;
  }

  private toProfile(payload: ClientTokenPayload): ClientProfile {
    return {
      accountId: payload.sub,
      telegramUserId: payload.tgu,
      name: payload.name ?? null,
      username: payload.username ?? null,
      photoUrl: payload.photo ?? null,
    };
  }
}
