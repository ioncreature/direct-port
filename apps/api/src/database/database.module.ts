import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CalculationConfig } from './entities/calculation-config.entity';
import { CalculationLog } from './entities/calculation-log.entity';
import { Document } from './entities/document.entity';
import { RefreshToken } from './entities/refresh-token.entity';
import { TelegramUser } from './entities/telegram-user.entity';
import { TnVedCode } from './entities/tn-ved-code.entity';
import { User } from './entities/user.entity';
import { Init1775502921706 } from './migrations/1775502921706-Init';
import { AddTelegramUsersAndDocuments1775509193348 } from './migrations/1775509193348-AddTelegramUsersAndDocuments';
import { AddCalculationConfig1775600000000 } from './migrations/1775600000000-AddCalculationConfig';
import { AddDocumentCurrency1775700000000 } from './migrations/1775700000000-AddDocumentCurrency';
import { AddAdminDocumentUpload1775800000000 } from './migrations/1775800000000-AddAdminDocumentUpload';
import { AddRequiresReviewStatus1775900000000 } from './migrations/1775900000000-AddRequiresReviewStatus';
import { AddDocumentIdToCalculationLog1776000000000 } from './migrations/1776000000000-AddDocumentIdToCalculationLog';
import { AddFileBufferAndParsingStatus1776100000000 } from './migrations/1776100000000-AddFileBufferAndParsingStatus';
import { SeedService } from './seeds/seed.service';

@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: 'postgres' as const,
        url: config.getOrThrow<string>('DATABASE_URL'),
        entities: [
          User,
          RefreshToken,
          TnVedCode,
          CalculationLog,
          TelegramUser,
          Document,
          CalculationConfig,
        ],
        synchronize: false,
        migrations: [
          Init1775502921706,
          AddTelegramUsersAndDocuments1775509193348,
          AddCalculationConfig1775600000000,
          AddDocumentCurrency1775700000000,
          AddAdminDocumentUpload1775800000000,
          AddRequiresReviewStatus1775900000000,
          AddDocumentIdToCalculationLog1776000000000,
          AddFileBufferAndParsingStatus1776100000000,
        ],
        migrationsRun: true,
      }),
    }),
    TypeOrmModule.forFeature([User, TnVedCode]),
  ],
  providers: [SeedService],
})
export class DatabaseModule {}
