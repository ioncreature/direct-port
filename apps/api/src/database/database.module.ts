import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { User } from './entities/user.entity';
import { RefreshToken } from './entities/refresh-token.entity';
import { TnVedCode } from './entities/tn-ved-code.entity';
import { CalculationLog } from './entities/calculation-log.entity';
import { Init1775502921706 } from './migrations/1775502921706-Init';

@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: 'postgres' as const,
        url: config.getOrThrow<string>('DATABASE_URL'),
        entities: [User, RefreshToken, TnVedCode, CalculationLog],
        synchronize: false,
        migrations: [Init1775502921706],
        migrationsRun: true,
      }),
    }),
  ],
})
export class DatabaseModule {}
