import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bullmq';
import { Document } from '../database/entities/document.entity';
import { DocumentsController } from './documents.controller';
import { DocumentsService } from './documents.service';
import { DocumentsProcessor } from './documents.processor';

@Module({
  imports: [
    TypeOrmModule.forFeature([Document]),
    BullModule.registerQueue({ name: 'document-processing' }),
  ],
  controllers: [DocumentsController],
  providers: [DocumentsService, DocumentsProcessor],
})
export class DocumentsModule {}
