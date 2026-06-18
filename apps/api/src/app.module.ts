import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { AppController } from './app.controller';
import { AuthModule } from './auth/auth.module';
import { JwtAuthGuard } from './auth/guards/jwt-auth.guard';
import { RolesGuard } from './auth/guards/roles.guard';
import { AiConfigModule } from './ai-config/ai-config.module';
import { BotLinksModule } from './bot-links/bot-links.module';
import { CalculationConfigModule } from './calculation-config/calculation-config.module';
import { CompaniesModule } from './companies/companies.module';
import { ConversationsModule } from './conversations/conversations.module';
import { CountriesModule } from './countries/countries.module';
import { DatabaseModule } from './database/database.module';
import { RedisModule } from './redis/redis.module';
import { DocumentsModule } from './documents/documents.module';
import { PipelineAuditModule } from './pipeline-audit/pipeline-audit.module';
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
        // Очистка завершённых/упавших джоб, иначе Redis растёт бесконечно.
        // attempts=1 задаём явно: воркеры обработки не идемпотентны (повторный
        // прогон задвоил бы CalculationLog и перезаписал resultData), поэтому
        // авто-ретраи отключены — восстановление через POST /documents/:id/reprocess.
        defaultJobOptions: {
          removeOnComplete: { age: 7 * 24 * 3600, count: 1000 },
          removeOnFail: { age: 30 * 24 * 3600 },
          attempts: 1,
        },
      }),
    }),
    DatabaseModule,
    RedisModule,
    PipelineAuditModule,
    AuthModule,
    UsersModule,
    CompaniesModule,
    TnVedModule,
    TelegramUsersModule,
    DocumentsModule,
    ConversationsModule,
    CalculationConfigModule,
    AiConfigModule,
    CountriesModule,
    BotLinksModule,
  ],
  controllers: [AppController],
  providers: [
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class AppModule {}
