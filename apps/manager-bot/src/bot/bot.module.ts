import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ApiClientModule } from '../api-client/api-client.module';
import { BotRegistry } from './bot-registry.service';
import { BotService } from './bot.service';
import { CallbackHandler } from './handlers/callback.handler';
import { ClientsHandler } from './handlers/clients.handler';
import { MessageHandler } from './handlers/message.handler';
import { NotifyHandler } from './handlers/notify.handler';
import { StartHandler } from './handlers/start.handler';
import { ActiveDialogModule } from './state/active-dialog.module';

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
    BullModule.registerQueue({ name: 'manager-notifications' }),
    ApiClientModule,
    ActiveDialogModule,
  ],
  providers: [
    BotRegistry,
    BotService,
    StartHandler,
    ClientsHandler,
    CallbackHandler,
    MessageHandler,
    NotifyHandler,
  ],
})
export class BotModule {}
