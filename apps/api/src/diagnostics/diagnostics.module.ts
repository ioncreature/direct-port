import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AiCall } from '../database/entities/ai-call.entity';
import { DocumentVersion } from '../database/entities/document-version.entity';
import { PipelineStageRun } from '../database/entities/pipeline-stage-run.entity';
import { DiagnosticsService } from './diagnostics.service';

@Module({
  imports: [TypeOrmModule.forFeature([PipelineStageRun, AiCall, DocumentVersion])],
  providers: [DiagnosticsService],
  exports: [DiagnosticsService],
})
export class DiagnosticsModule {}
