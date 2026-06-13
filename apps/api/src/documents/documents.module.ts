import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AiParserModule } from '../ai-parser/ai-parser.module';
import { CalculationConfigModule } from '../calculation-config/calculation-config.module';
import { CalculationLogsModule } from '../calculation-logs/calculation-logs.module';
import { CalculatorModule } from '../calculator/calculator.module';
import { ClassifierModule } from '../classifier/classifier.module';
import { CountriesModule } from '../countries/countries.module';
import { CurrencyModule } from '../currency/currency.module';
import { AiUsageLog } from '../database/entities/ai-usage-log.entity';
import { Document } from '../database/entities/document.entity';
import { TelegramUser } from '../database/entities/telegram-user.entity';
import { DiagnosticsModule } from '../diagnostics/diagnostics.module';
import { DutyInterpreterModule } from '../duty-interpreter/duty-interpreter.module';
import { DocumentsParsingProcessor } from './documents-parsing.processor';
import { DocumentsController } from './documents.controller';
import { DocumentsProcessor } from './documents.processor';
import { DocumentsService } from './documents.service';
import { ExcelExportService } from './excel-export.service';
import { ManualCodeService } from './manual-code.service';
import { PipelineNotifierService } from './pipeline-notifier.service';
import { StuckDocumentsWatchdog } from './stuck-documents.watchdog';
import { PhotoStorageModule } from '../photo-storage/photo-storage.module';
import { RegulatoryModule } from '../regulatory/regulatory.module';
import { TksModule } from '../tks/tks.module';
import { ManagerNotifyModule } from '../conversations/manager-notify.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Document, TelegramUser, AiUsageLog]),
    BullModule.registerQueue({ name: 'document-parsing' }),
    BullModule.registerQueue({ name: 'document-processing' }),
    ClassifierModule,
    CalculatorModule,
    CalculationConfigModule,
    AiParserModule,
    CurrencyModule,
    DutyInterpreterModule,
    CalculationLogsModule,
    CountriesModule,
    DiagnosticsModule,
    PhotoStorageModule,
    RegulatoryModule,
    TksModule,
    ManagerNotifyModule,
  ],
  controllers: [DocumentsController],
  providers: [
    DocumentsService,
    DocumentsProcessor,
    DocumentsParsingProcessor,
    ExcelExportService,
    ManualCodeService,
    PipelineNotifierService,
    StuckDocumentsWatchdog,
  ],
  exports: [DocumentsService],
})
export class DocumentsModule {}
