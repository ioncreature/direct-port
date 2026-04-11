import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import * as bcrypt from 'bcrypt';
import { randomUUID } from 'crypto';
import { MoreThan, Repository } from 'typeorm';
import { RefreshToken } from '../database/entities/refresh-token.entity';
import { User } from '../database/entities/user.entity';

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(User) private usersRepo: Repository<User>,
    @InjectRepository(RefreshToken) private refreshRepo: Repository<RefreshToken>,
    private jwtService: JwtService,
    private config: ConfigService,
  ) {}

  async login(email: string, password: string) {
    const user = await this.usersRepo.findOne({ where: { email } });
    if (!user || !user.isActive) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) {
      throw new UnauthorizedException('Invalid credentials');
    }

    return this.generateTokens(user);
  }

  async refresh(refreshToken: string) {
    const tokens = await this.refreshRepo.find({
      where: { expiresAt: MoreThan(new Date()) },
      relations: ['user'],
    });

    let found: RefreshToken | null = null;
    for (const token of tokens) {
      if (await bcrypt.compare(refreshToken, token.tokenHash)) {
        found = token;
        break;
      }
    }

    if (!found || !found.user.isActive) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    await this.refreshRepo.delete(found.id);
    return this.generateTokens(found.user);
  }

  async logout(refreshToken: string) {
    const tokens = await this.refreshRepo.find();
    for (const token of tokens) {
      if (await bcrypt.compare(refreshToken, token.tokenHash)) {
        await this.refreshRepo.delete(token.id);
        return;
      }
    }
  }

  private async generateTokens(user: User) {
    const payload = { sub: user.id, email: user.email, role: user.role };

    const accessToken = this.jwtService.sign(payload, {
      expiresIn: this.config.get('JWT_ACCESS_EXPIRATION', '15m'),
    });

    const rawRefresh = randomUUID();
    const tokenHash = await bcrypt.hash(rawRefresh, 10);
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7);

    await this.refreshRepo.save({
      userId: user.id,
      tokenHash,
      expiresAt,
    });

    return {
      accessToken,
      refreshToken: rawRefresh,
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
      },
    };
  }
}
