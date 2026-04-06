import { Module } from '@nestjs/common';
import { ApiClientModule } from '../api-client/api-client.module';
import { ExcelModule } from '../excel/excel.module';
import { ClassifierModule } from '../classifier/classifier.module';
import { CalculatorModule } from '../calculator/calculator.module';
import { ConversationStateModule } from './state/conversation-state.module';
import { BotService } from './bot.service';
import { StartHandler } from './handlers/start.handler';
import { HelpHandler } from './handlers/help.handler';
import { DocumentHandler } from './handlers/document.handler';
import { MenuHandler } from './handlers/menu.handler';
import { FileUploadHandler } from './handlers/file-upload.handler';
import { CallbackQueryHandler } from './handlers/callback-query.handler';

@Module({
  imports: [
    ApiClientModule,
    ExcelModule,
    ClassifierModule,
    CalculatorModule,
    ConversationStateModule,
  ],
  providers: [
    BotService,
    StartHandler,
    HelpHandler,
    DocumentHandler,
    MenuHandler,
    FileUploadHandler,
    CallbackQueryHandler,
  ],
})
export class BotModule {}
