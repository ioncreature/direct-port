import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Bot } from 'grammy';
import { StartHandler } from './handlers/start.handler';
import { HelpHandler } from './handlers/help.handler';
import { DocumentHandler } from './handlers/document.handler';

@Injectable()
export class BotService implements OnModuleInit, OnModuleDestroy {
  private logger = new Logger(BotService.name);
  private bot: Bot;

  constructor(
    private config: ConfigService,
    private startHandler: StartHandler,
    private helpHandler: HelpHandler,
    private documentHandler: DocumentHandler,
  ) {
    const token = this.config.get<string>('TELEGRAM_BOT_TOKEN');
    if (!token) {
      this.logger.warn('TELEGRAM_BOT_TOKEN not set, bot will not start');
      this.bot = null as unknown as Bot;
      return;
    }
    this.bot = new Bot(token);
  }

  async onModuleInit() {
    if (!this.bot) return;

    this.bot.command('start', (ctx) => this.startHandler.handle(ctx));
    this.bot.command('help', (ctx) => this.helpHandler.handle(ctx));
    this.bot.on('message:document', (ctx) => this.documentHandler.handle(ctx));

    this.bot.catch((err) => {
      this.logger.error('Bot error:', err.message);
    });

    this.bot.start();
    this.logger.log('Telegram bot started');
  }

  async onModuleDestroy() {
    if (this.bot) {
      await this.bot.stop();
    }
  }
}
