import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AiCall } from './entities/ai-call.entity';
import { AiConfig } from './entities/ai-config.entity';
import { AiUsageLog } from './entities/ai-usage-log.entity';
import { CalculationConfig } from './entities/calculation-config.entity';
import { CalculationLog } from './entities/calculation-log.entity';
import { Document } from './entities/document.entity';
import { DocumentPhoto } from './entities/document-photo.entity';
import { DocumentVersion } from './entities/document-version.entity';
import { DutyInterpretationCache } from './entities/duty-interpretation-cache.entity';
import { PipelineStageRun } from './entities/pipeline-stage-run.entity';
import { RefreshToken } from './entities/refresh-token.entity';
import { TelegramUser } from './entities/telegram-user.entity';
import { TksCache } from './entities/tks-cache.entity';
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
import { AddLanguageFields1776200000000 } from './migrations/1776200000000-AddLanguageFields';
import { AddRejectedStatusAndReasons1776200000000 } from './migrations/1776200000000-AddRejectedStatusAndReasons';
import { AddTokenUsageFields1776300000000 } from './migrations/1776300000000-AddTokenUsageFields';
import { AddAiConfig1776400000000 } from './migrations/1776400000000-AddAiConfig';
import { AddTksCache1776500000000 } from './migrations/1776500000000-AddTksCache';
import { AddProcessedWithErrorsStatus1776600000000 } from './migrations/1776600000000-AddProcessedWithErrorsStatus';
import { AddExchangeRates1776700000000 } from './migrations/1776700000000-AddExchangeRates';
import { AddSendResultFile1776800000000 } from './migrations/1776800000000-AddSendResultFile';
import { AddAiUsageLog1776900000000 } from './migrations/1776900000000-AddAiUsageLog';
import { AddQueryFormulationModel1777000000000 } from './migrations/1777000000000-AddQueryFormulationModel';
import { AddCodeReviewRequiredStatus1777100000000 } from './migrations/1777100000000-AddCodeReviewRequiredStatus';
import { AddCalculationLogDocumentIdIndex1777200000000 } from './migrations/1777200000000-AddCalculationLogDocumentIdIndex';
import { AddDocumentCountryAndCountriesCache1777300000000 } from './migrations/1777300000000-AddDocumentCountryAndCountriesCache';
import { AddCalculationLogTrigger1777400000000 } from './migrations/1777400000000-AddCalculationLogTrigger';
import { DropCountriesCache1777500000000 } from './migrations/1777500000000-DropCountriesCache';
import { AddPipelineAudit1777600000000 } from './migrations/1777600000000-AddPipelineAudit';
import { AddDutyInterpretationCache1777700000000 } from './migrations/1777700000000-AddDutyInterpretationCache';
import { AddPhotoClassifierModel1777800000000 } from './migrations/1777800000000-AddPhotoClassifierModel';
import { AddDocumentPhotos1777900000000 } from './migrations/1777900000000-AddDocumentPhotos';
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
          AiConfig,
          TksCache,
          AiUsageLog,
          PipelineStageRun,
          AiCall,
          DocumentVersion,
          DutyInterpretationCache,
          DocumentPhoto,
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
          AddLanguageFields1776200000000,
          AddRejectedStatusAndReasons1776200000000,
          AddTokenUsageFields1776300000000,
          AddAiConfig1776400000000,
          AddTksCache1776500000000,
          AddProcessedWithErrorsStatus1776600000000,
          AddExchangeRates1776700000000,
          AddSendResultFile1776800000000,
          AddAiUsageLog1776900000000,
          AddQueryFormulationModel1777000000000,
          AddCodeReviewRequiredStatus1777100000000,
          AddCalculationLogDocumentIdIndex1777200000000,
          AddDocumentCountryAndCountriesCache1777300000000,
          AddCalculationLogTrigger1777400000000,
          DropCountriesCache1777500000000,
          AddPipelineAudit1777600000000,
          AddDutyInterpretationCache1777700000000,
          AddPhotoClassifierModel1777800000000,
          AddDocumentPhotos1777900000000,
        ],
        migrationsRun: true,
      }),
    }),
    TypeOrmModule.forFeature([User, TnVedCode]),
  ],
  providers: [SeedService],
})
export class DatabaseModule {}
