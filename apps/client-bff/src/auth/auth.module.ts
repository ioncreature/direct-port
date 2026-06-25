import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { ApiClientModule } from '../api-client/api-client.module';
import { AuthController } from './auth.controller';
import { ClientAuthGuard } from './client-auth.guard';
import { ClientTokenService } from './client-token.service';
import { TelegramAuthService } from './telegram-auth.service';

@Module({
  imports: [
    ApiClientModule,
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.getOrThrow<string>('CLIENT_JWT_SECRET'),
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [TelegramAuthService, ClientTokenService, ClientAuthGuard],
  exports: [ClientTokenService, ClientAuthGuard],
})
export class AuthModule {}
