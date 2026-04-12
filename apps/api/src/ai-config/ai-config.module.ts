import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AiConfig } from '../database/entities/ai-config.entity';
import { AiConfigController } from './ai-config.controller';
import { AiConfigService } from './ai-config.service';

@Module({
  imports: [TypeOrmModule.forFeature([AiConfig])],
  controllers: [AiConfigController],
  providers: [AiConfigService],
  exports: [AiConfigService],
})
export class AiConfigModule {}
