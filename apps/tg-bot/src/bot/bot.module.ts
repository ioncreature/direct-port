import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ApiClientModule } from '../api-client/api-client.module';
import { ExcelModule } from '../excel/excel.module';
import { BotService } from './bot.service';
import { CallbackQueryHandler } from './handlers/callback-query.handler';
import { FileUploadHandler } from './handlers/file-upload.handler';
import { HelpHandler } from './handlers/help.handler';
import { MenuHandler } from './handlers/menu.handler';
import { NotificationHandler } from './handlers/notification.handler';
import { StartHandler } from './handlers/start.handler';
import { ConversationStateModule } from './state/conversation-state.module';

@Module({
  imports: [
    BullModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        connection: {
          url: config.get('REDIS_URL', 'redis://localhost:6380'),
        },
      }),
    }),
    BullModule.registerQueue({ name: 'document-notifications' }),
    ApiClientModule,
    ExcelModule,
    ConversationStateModule,
  ],
  providers: [
    BotService,
    StartHandler,
    HelpHandler,
    MenuHandler,
    FileUploadHandler,
    CallbackQueryHandler,
    NotificationHandler,
  ],
})
export class BotModule {}
