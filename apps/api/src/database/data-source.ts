import { config } from 'dotenv';
import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { AiCall } from './entities/ai-call.entity';
import { AiUsageLog } from './entities/ai-usage-log.entity';
import { CalculationConfig } from './entities/calculation-config.entity';
import { CalculationLog } from './entities/calculation-log.entity';
import { Document } from './entities/document.entity';
import { DocumentVersion } from './entities/document-version.entity';
import { PipelineStageRun } from './entities/pipeline-stage-run.entity';
import { RefreshToken } from './entities/refresh-token.entity';
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
  ],
  migrations: ['src/database/migrations/*{.ts,.js}'],
});
