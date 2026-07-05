import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Document } from '../database/entities/document.entity';
import { DocumentsModule } from '../documents/documents.module';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';

/** Сводная статистика для дашборда админки (GET /dashboard/stats). */
@Module({
  imports: [TypeOrmModule.forFeature([Document]), DocumentsModule],
  controllers: [DashboardController],
  providers: [DashboardService],
})
export class DashboardModule {}
