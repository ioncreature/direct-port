import { Module } from '@nestjs/common';
import { ApiClientModule } from '../api-client/api-client.module';
import { ExcelModule } from '../excel/excel.module';
import { ClassifierModule } from '../classifier/classifier.module';
import { CalculatorModule } from '../calculator/calculator.module';
import { BotService } from './bot.service';
import { StartHandler } from './handlers/start.handler';
import { HelpHandler } from './handlers/help.handler';
import { DocumentHandler } from './handlers/document.handler';

@Module({
  imports: [ApiClientModule, ExcelModule, ClassifierModule, CalculatorModule],
  providers: [BotService, StartHandler, HelpHandler, DocumentHandler],
})
export class BotModule {}
