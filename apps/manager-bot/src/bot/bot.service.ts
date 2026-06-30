import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Bot, type Context, type NextFunction } from 'grammy';
import { ApiClientService } from '../api-client/api-client.service';
import { BotRegistry, DEFAULT_COMPANY_ID } from './bot-registry.service';
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

/**
 * Поднимает менеджерские боты: дефолтный из env TELEGRAM_BOT_TOKEN (привязан к дефолтной компании)
 * и по одному боту на каждую компанию с заведённым токеном (GET /internal/bots). Каждый бот
 * настраивается одинаково (configure). Реестр (Api по companyId) использует NotifyHandler для
 * доставки уведомлений. См. docs/COMPANY_BOTS.md.
 */
@Injectable()
export class BotService implements OnModuleInit, OnModuleDestroy {
  private logger = new Logger(BotService.name);

  constructor(
    private config: ConfigService,
    private startHandler: StartHandler,
    private clientsHandler: ClientsHandler,
    private callbackHandler: CallbackHandler,
    private messageHandler: MessageHandler,
    private apiClient: ApiClientService,
    private registry: BotRegistry,
  ) {}

  async onModuleInit() {
    await this.loadBots();
    const bots = this.registry.all();
    if (bots.length === 0) {
      this.logger.warn('No manager bots configured — nothing to start');
      return;
    }
    for (const { bot, companyId } of bots) {
      // fire-and-forget: bot.start() резолвится только при остановке (long-polling loop).
      void bot.start();
      this.logger.log(`Manager bot started for company ${companyId}`);
    }
  }

  /** Дефолтный бот из env + боты компаний из api. Сбой загрузки компаний не валит дефолтный. */
  private async loadBots(): Promise<void> {
    const envToken = this.config.get<string>('TELEGRAM_BOT_TOKEN');
    if (envToken) {
      this.addBot(DEFAULT_COMPANY_ID, envToken);
    } else {
      this.logger.warn('TELEGRAM_BOT_TOKEN not set — default company bot will not start');
    }
    try {
      const companyBots = await this.apiClient.listBots();
      for (const cb of companyBots) {
        if (cb.companyId === DEFAULT_COMPANY_ID) continue; // env-токен имеет приоритет
        this.addBot(cb.companyId, cb.token);
      }
      this.logger.log(`Loaded ${this.registry.all().length} manager bot(s)`);
    } catch (err) {
      this.logger.error(`Failed to load company bots from API: ${(err as Error).message}`);
    }
  }

  private addBot(companyId: string, token: string): void {
    const bot = new Bot(token);
    this.configure(bot);
    this.registry.register({ companyId, bot });
    // Глобальную bot-link публикуем только для дефолтного бота; per-company identity — Фаза 2.
    if (companyId === DEFAULT_COMPANY_ID) void this.publishIdentity(bot);
  }

  private configure(bot: Bot): void {
    bot.use((ctx, next) => this.logUpdate(ctx, next));

    bot.command('start', (ctx) => this.startHandler.handle(ctx));
    bot.command('clients', (ctx) => this.clientsHandler.handle(ctx));
    bot.command('help', (ctx) => ctx.reply(HELP_TEXT));

    bot.on('callback_query:data', (ctx) => this.callbackHandler.handle(ctx));
    bot.on('message:text', (ctx) => this.messageHandler.handle(ctx));
    // Всё, что не текст (фото, файлы, стикеры): в режиме ответа предупреждаем, что
    // вложения клиенту не доставляются, — иначе менеджер уверен, что скриншот ушёл.
    bot.on('message', (ctx) => this.messageHandler.handleNonText(ctx));

    bot.catch((err) => {
      const ctx = err.ctx;
      const user = formatUser(ctx);
      this.logger.error(
        `Bot error for update ${ctx.update.update_id}${user ? ' from ' + user : ''}: ${err.message}`,
        err.error instanceof Error ? err.error.stack : undefined,
      );
    });
  }

  /** Резолвит username через getMe и публикует ссылку в API (для админки). */
  private async publishIdentity(bot: Bot): Promise<void> {
    try {
      const me = await bot.api.getMe();
      if (!me.username) return;
      await this.apiClient.publishBotIdentity(me.username);
      this.logger.log(`Bot identity published: @${me.username}`);
    } catch (err) {
      this.logger.warn(`Failed to publish bot identity: ${(err as Error).message}`);
    }
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
    await Promise.all(this.registry.all().map(({ bot }) => bot.stop().catch(() => undefined)));
  }
}
