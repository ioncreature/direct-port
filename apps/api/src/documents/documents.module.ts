import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bullmq';
import { Document } from '../database/entities/document.entity';
import { ClassifierModule } from '../classifier/classifier.module';
import { CalculatorModule } from '../calculator/calculator.module';
import { CalculationConfigModule } from '../calculation-config/calculation-config.module';
import { VerificationModule } from '../verification/verification.module';
import { AiParserModule } from '../ai-parser/ai-parser.module';
import { CurrencyModule } from '../currency/currency.module';
import { DutyInterpreterModule } from '../duty-interpreter/duty-interpreter.module';
import { CalculationLogsModule } from '../calculation-logs/calculation-logs.module';
import { DocumentsController } from './documents.controller';
import { DocumentsService } from './documents.service';
import { DocumentsProcessor } from './documents.processor';
import { ExcelExportService } from './excel-export.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Document]),
    BullModule.registerQueue({ name: 'document-processing' }),
    BullModule.registerQueue({ name: 'document-notifications' }),
    ClassifierModule,
    CalculatorModule,
    CalculationConfigModule,
    VerificationModule,
    AiParserModule,
    CurrencyModule,
    DutyInterpreterModule,
    CalculationLogsModule,
  ],
  controllers: [DocumentsController],
  providers: [DocumentsService, DocumentsProcessor, ExcelExportService],
})
export class DocumentsModule {}
