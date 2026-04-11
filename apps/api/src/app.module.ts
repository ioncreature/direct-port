import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { AppController } from './app.controller';
import { AuthModule } from './auth/auth.module';
import { JwtAuthGuard } from './auth/guards/jwt-auth.guard';
import { RolesGuard } from './auth/guards/roles.guard';
import { CalculationConfigModule } from './calculation-config/calculation-config.module';
import { CalculationLogsModule } from './calculation-logs/calculation-logs.module';
import { DatabaseModule } from './database/database.module';
import { DocumentsModule } from './documents/documents.module';
import { TelegramUsersModule } from './telegram-users/telegram-users.module';
import { TnVedModule } from './tn-ved/tn-ved.module';
import { UsersModule } from './users/users.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        connection: {
          url: config.get('REDIS_URL', 'redis://localhost:6380'),
        },
      }),
    }),
    DatabaseModule,
    AuthModule,
    UsersModule,
    TnVedModule,
    TelegramUsersModule,
    DocumentsModule,
    CalculationConfigModule,
    CalculationLogsModule,
  ],
  controllers: [AppController],
  providers: [
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class AppModule {}
