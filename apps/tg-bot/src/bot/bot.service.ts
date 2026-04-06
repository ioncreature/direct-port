import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Bot } from 'grammy';
import { StartHandler } from './handlers/start.handler';
import { HelpHandler } from './handlers/help.handler';
import { MenuHandler } from './handlers/menu.handler';
import { FileUploadHandler } from './handlers/file-upload.handler';
import { CallbackQueryHandler } from './handlers/callback-query.handler';

@Injectable()
export class BotService implements OnModuleInit, OnModuleDestroy {
  private logger = new Logger(BotService.name);
  private bot: Bot;

  constructor(
    private config: ConfigService,
    private startHandler: StartHandler,
    private helpHandler: HelpHandler,
    private menuHandler: MenuHandler,
    private fileUploadHandler: FileUploadHandler,
    private callbackQueryHandler: CallbackQueryHandler,
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

    // Reply keyboard text handlers
    this.bot.hears('📁 Загрузить файл', (ctx) => this.menuHandler.handleUpload(ctx));
    this.bot.hears('❓ Помощь', (ctx) => this.menuHandler.handleHelp(ctx));

    // Commands
    this.bot.command('start', (ctx) => this.startHandler.handle(ctx));
    this.bot.command('help', (ctx) => this.helpHandler.handle(ctx));

    // Callback queries (inline keyboard column selection)
    this.bot.on('callback_query:data', (ctx) => this.callbackQueryHandler.handle(ctx));

    // Document upload
    this.bot.on('message:document', (ctx) => this.fileUploadHandler.handle(ctx));

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
