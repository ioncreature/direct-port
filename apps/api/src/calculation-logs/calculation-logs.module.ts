import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CalculationLog } from '../database/entities/calculation-log.entity';
import { CalculationLogsService } from './calculation-logs.service';

@Module({
  imports: [TypeOrmModule.forFeature([CalculationLog])],
  providers: [CalculationLogsService],
  exports: [CalculationLogsService],
})
export class CalculationLogsModule {}
