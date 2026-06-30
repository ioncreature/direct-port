import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Company } from '../database/entities/company.entity';
import { BotsController } from './bots.controller';
import { BotsService } from './bots.service';
import { CompanyBotsController } from './company-bots.controller';

/**
 * Боты компаний: internal-эндпоинт, по которому client-bot / manager-bot забирают токены своих
 * ботов (BotsController), и self-service-управление токенами из админки (CompanyBotsController).
 * SecretCipher приходит из глобального CryptoModule, REDIS_CLIENT — из RedisModule. См. docs/COMPANY_BOTS.md.
 */
@Module({
  imports: [TypeOrmModule.forFeature([Company])],
  controllers: [BotsController, CompanyBotsController],
  providers: [BotsService],
})
export class BotsModule {}
