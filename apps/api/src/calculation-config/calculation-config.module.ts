import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CalculationConfig } from '../database/entities/calculation-config.entity';
import { CalculationConfigController } from './calculation-config.controller';
import { CalculationConfigService } from './calculation-config.service';

@Module({
  imports: [TypeOrmModule.forFeature([CalculationConfig])],
  controllers: [CalculationConfigController],
  providers: [CalculationConfigService],
  exports: [CalculationConfigService],
})
export class CalculationConfigModule {}
