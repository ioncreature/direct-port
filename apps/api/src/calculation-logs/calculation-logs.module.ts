import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CalculationLog } from '../database/entities/calculation-log.entity';
import { CalculationLogsController } from './calculation-logs.controller';
import { CalculationLogsService } from './calculation-logs.service';

@Module({
  imports: [TypeOrmModule.forFeature([CalculationLog])],
  controllers: [CalculationLogsController],
  providers: [CalculationLogsService],
  exports: [CalculationLogsService],
})
export class CalculationLogsModule {}
