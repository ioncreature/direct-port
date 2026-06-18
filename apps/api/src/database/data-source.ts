import { config } from 'dotenv';
import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { AiCall } from './entities/ai-call.entity';
import { AiConfig } from './entities/ai-config.entity';
import { AiUsageLog } from './entities/ai-usage-log.entity';
import { CalculationConfig } from './entities/calculation-config.entity';
import { CalculationLog } from './entities/calculation-log.entity';
import { Company } from './entities/company.entity';
import { ConversationMessage } from './entities/conversation-message.entity';
import { Document } from './entities/document.entity';
import { DocumentPhoto } from './entities/document-photo.entity';
import { DocumentVersion } from './entities/document-version.entity';
import { DutyInterpretationCache } from './entities/duty-interpretation-cache.entity';
import { PipelineStageRun } from './entities/pipeline-stage-run.entity';
import { RefreshToken } from './entities/refresh-token.entity';
import { RegulatoryInterpretationCache } from './entities/regulatory-interpretation-cache.entity';
import { TelegramUser } from './entities/telegram-user.entity';
import { TksCache } from './entities/tks-cache.entity';
import { TnVedCode } from './entities/tn-ved-code.entity';
import { User } from './entities/user.entity';

config();

export default new DataSource({
  type: 'postgres',
  url: process.env.DATABASE_URL || 'postgresql://directport:directport@localhost:5434/directport',
  entities: [
    User,
    Company,
    RefreshToken,
    TnVedCode,
    CalculationLog,
    TelegramUser,
    Document,
    CalculationConfig,
    TksCache,
    AiUsageLog,
    PipelineStageRun,
    AiCall,
    DocumentVersion,
    AiConfig,
    ConversationMessage,
    DocumentPhoto,
    DutyInterpretationCache,
    RegulatoryInterpretationCache,
  ],
  migrations: ['src/database/migrations/*{.ts,.js}'],
  // Каждая миграция в своей транзакции — чтобы новое значение enum 'super_admin' было
  // закоммичено до использования в бэкафилле следующей миграции (иначе PG 55P04).
  migrationsTransactionMode: 'each',
});
