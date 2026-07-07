import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AiCall } from '../database/entities/ai-call.entity';
import { DocumentVersion } from '../database/entities/document-version.entity';
import { PipelineStageRun } from '../database/entities/pipeline-stage-run.entity';
import { PipelineAuditRetentionService } from './pipeline-audit-retention.service';
import { PipelineAuditService } from './pipeline-audit.service';

@Global()
@Module({
  imports: [TypeOrmModule.forFeature([PipelineStageRun, AiCall, DocumentVersion])],
  providers: [PipelineAuditService, PipelineAuditRetentionService],
  exports: [PipelineAuditService],
})
export class PipelineAuditModule {}
