import { config } from 'dotenv';
import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { CalculationConfig } from './entities/calculation-config.entity';
import { CalculationLog } from './entities/calculation-log.entity';
import { Document } from './entities/document.entity';
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
  ],
  migrations: ['src/database/migrations/*{.ts,.js}'],
});
