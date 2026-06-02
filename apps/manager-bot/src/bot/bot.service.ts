import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Bot, type Context, type NextFunction } from 'grammy';
import { formatUser } from './format-user';
import { CallbackHandler } from './handlers/callback.handler';
import { ClientsHandler } from './handlers/clients.handler';
import { MessageHandler } from './handlers/message.handler';
import { StartHandler } from './handlers/start.handler';

const HELP_TEXT = [
  'DirectPort — бот менеджера.',
  '',
  'Сюда приходят новые файлы и сообщения клиентов. Действия — кнопками под уведомлением:',
  '• 🚀 Запустить расчёт — отправить файл клиента в обработку',
  '• 👤 Взять — закрепить клиента за собой',
  '• ✍️ Ответить — написать клиенту (затем просто отправьте текст)',
  '• ↗️ В админке — открыть документ/клиента в веб-админке',
  '',
  '/clients — мои активные диалоги',
].join('\n');

@Injectable()
export class BotService implements OnModuleInit, OnModuleDestroy {
  private logger = new Logger(BotService.name);
  private bot: Bot;

  constructor(
    private config: ConfigService,
    private startHandler: StartHandler,
    private clientsHandler: ClientsHandler,
    private callbackHandler: CallbackHandler,
    private messageHandler: MessageHandler,
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

    this.bot.use((ctx, next) => this.logUpdate(ctx, next));

    this.bot.command('start', (ctx) => this.startHandler.handle(ctx));
    this.bot.command('clients', (ctx) => this.clientsHandler.handle(ctx));
    this.bot.command('help', (ctx) => ctx.reply(HELP_TEXT));

    this.bot.on('callback_query:data', (ctx) => this.callbackHandler.handle(ctx));
    this.bot.on('message:text', (ctx) => this.messageHandler.handle(ctx));

    this.bot.catch((err) => {
      const ctx = err.ctx;
      const user = formatUser(ctx);
      this.logger.error(
        `Bot error for update ${ctx.update.update_id}${user ? ' from ' + user : ''}: ${err.message}`,
        err.error instanceof Error ? err.error.stack : undefined,
      );
    });

    this.bot.start();
    this.logger.log('Manager bot started');
  }

  private async logUpdate(ctx: Context, next: NextFunction): Promise<void> {
    const user = formatUser(ctx) || 'unknown';
    const action = this.describeUpdate(ctx);
    const startedAt = Date.now();
    this.logger.log(`→ ${action} | ${user}`);
    try {
      await next();
      this.logger.log(`✓ ${action} | ${user} | ${Date.now() - startedAt}ms`);
    } catch (err) {
      this.logger.error(
        `✗ ${action} | ${user} | ${Date.now() - startedAt}ms | ${(err as Error).message}`,
        (err as Error).stack,
      );
      throw err;
    }
  }

  private describeUpdate(ctx: Context): string {
    if (ctx.hasCommand('start')) return 'command /start';
    if (ctx.hasCommand('clients')) return 'command /clients';
    if (ctx.hasCommand('help')) return 'command /help';
    const callbackData = ctx.callbackQuery?.data;
    if (callbackData) return `callback_query "${callbackData}"`;
    const text = ctx.message?.text;
    if (text) {
      const preview = text.length > 50 ? text.slice(0, 50) + '...' : text;
      return `text "${preview}"`;
    }
    return `update type=${Object.keys(ctx.update)
      .filter((k) => k !== 'update_id')
      .join(',')}`;
  }

  async onModuleDestroy() {
    if (this.bot) {
      await this.bot.stop();
    }
  }
}
