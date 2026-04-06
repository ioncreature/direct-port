import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { config } from 'dotenv';
import { User } from './entities/user.entity';
import { RefreshToken } from './entities/refresh-token.entity';
import { TnVedCode } from './entities/tn-ved-code.entity';
import { CalculationLog } from './entities/calculation-log.entity';

config();

export default new DataSource({
  type: 'postgres',
  url: process.env.DATABASE_URL || 'postgresql://directport:directport@localhost:5434/directport',
  entities: [User, RefreshToken, TnVedCode, CalculationLog],
  migrations: ['src/database/migrations/*{.ts,.js}'],
});
