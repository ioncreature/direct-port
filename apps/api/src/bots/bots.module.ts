import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Company } from '../database/entities/company.entity';
import { BotsController } from './bots.controller';
import { BotsService } from './bots.service';

/**
 * Реестр ботов компаний: internal-эндпоинт, по которому client-bot / manager-bot забирают
 * токены своих ботов. SecretCipher приходит из глобального CryptoModule. См. docs/COMPANY_BOTS.md.
 */
@Module({
  imports: [TypeOrmModule.forFeature([Company])],
  controllers: [BotsController],
  providers: [BotsService],
})
export class BotsModule {}
