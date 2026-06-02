import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ApiClientModule } from '../api-client/api-client.module';
import { BotService } from './bot.service';
import { ClientResolverService } from './client-resolver.service';
import { FileUploadHandler } from './handlers/file-upload.handler';
import { HelpHandler } from './handlers/help.handler';
import { LanguageHandler } from './handlers/language.handler';
import { MessageHandler } from './handlers/message.handler';
import { OutgoingHandler } from './handlers/outgoing.handler';
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
    BullModule.registerQueue({ name: 'client-bot-outgoing' }),
    ApiClientModule,
    ConversationStateModule,
  ],
  providers: [
    BotService,
    ClientResolverService,
    StartHandler,
    HelpHandler,
    LanguageHandler,
    FileUploadHandler,
    MessageHandler,
    OutgoingHandler,
  ],
})
export class BotModule {}
