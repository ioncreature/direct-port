import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Bot, type NextFunction } from 'grammy';
import { ApiClientService } from '../api-client/api-client.service';
import { BotRegistry, DEFAULT_COMPANY_ID } from './bot-registry.service';
import { formatUser } from './format-user';
import { FileUploadHandler } from './handlers/file-upload.handler';
import { HelpHandler } from './handlers/help.handler';
import { LanguageHandler } from './handlers/language.handler';
import { MessageHandler } from './handlers/message.handler';
import { StartHandler } from './handlers/start.handler';
import { type BotContext, i18n, SUPPORTED_LOCALES } from './i18n';
import { ConversationStateService } from './state/conversation-state.service';

/**
 * Поднимает клиентские боты: дефолтный из env TELEGRAM_BOT_TOKEN (привязан к дефолтной компании)
 * и по одному боту на каждую компанию с заведённым токеном (GET /internal/bots). Каждый бот
 * настраивается одинаково (configure) и помечает входящие апдейты своим companyId. Реестр (Api по
 * companyId) использует OutgoingHandler для доставки. См. docs/COMPANY_BOTS.md.
 */
@Injectable()
export class BotService implements OnModuleInit, OnModuleDestroy {
  private logger = new Logger(BotService.name);

  constructor(
    private config: ConfigService,
    private startHandler: StartHandler,
    private helpHandler: HelpHandler,
    private languageHandler: LanguageHandler,
    private fileUploadHandler: FileUploadHandler,
    private messageHandler: MessageHandler,
    private stateService: ConversationStateService,
    private apiClient: ApiClientService,
    private registry: BotRegistry,
  ) {}

  async onModuleInit() {
    await this.loadBots();
    const bots = this.registry.all();
    if (bots.length === 0) {
      this.logger.warn('No client bots configured — nothing to start');
      return;
    }
    for (const { bot, companyId } of bots) {
      // fire-and-forget: bot.start() резолвится только при остановке (long-polling loop).
      void bot.start();
      this.logger.log(`Client bot started for company ${companyId}`);
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
      this.logger.log(`Loaded ${this.registry.all().length} client bot(s)`);
    } catch (err) {
      this.logger.error(`Failed to load company bots from API: ${(err as Error).message}`);
    }
  }

  private addBot(companyId: string, token: string): void {
    const bot = new Bot<BotContext>(token);
    this.configure(bot, companyId);
    this.registry.register({ companyId, bot });
    // Глобальную bot-link публикуем только для дефолтного бота; per-company identity — Фаза 2.
    if (companyId === DEFAULT_COMPANY_ID) void this.publishIdentity(bot);
  }

  /** Навешивает middleware и хендлеры на бот компании (companyId кладётся в контекст первым). */
  private configure(bot: Bot<BotContext>, companyId: string): void {
    bot.use((ctx, next) => {
      ctx.companyId = companyId;
      return next();
    });
    bot.use((ctx, next) => this.logUpdate(ctx, next));
    bot.use(i18n.middleware());

    // Restore locale from Redis state
    bot.use(async (ctx, next) => {
      const chatId = ctx.chat?.id;
      if (chatId) {
        const state = await this.stateService.getState(chatId);
        if (state?.language) ctx.i18n.useLocale(state.language);
      }
      return next();
    });

    // Reply keyboard "help" button — match all locale variants
    const helpTexts = SUPPORTED_LOCALES.map((l) => i18n.t(l, 'btn-help'));
    bot.hears(helpTexts, (ctx) => this.helpHandler.handle(ctx));

    bot.command('start', (ctx) => this.startHandler.handle(ctx));
    bot.command('help', (ctx) => this.helpHandler.handle(ctx));
    bot.command('language', (ctx) => this.languageHandler.handleCommand(ctx));

    bot.on('callback_query:data', async (ctx) => {
      const data = ctx.callbackQuery.data;
      if (data.startsWith('lang_')) {
        await this.languageHandler.handleCallback(ctx);
        return;
      }
      await ctx.answerCallbackQuery().catch(() => undefined);
    });

    // Файл от клиента → managed intake (без запуска пайплайна)
    bot.on('message:document', (ctx) => this.fileUploadHandler.handle(ctx));
    // Фото и текст → релей менеджеру
    bot.on('message:photo', (ctx) => this.messageHandler.handlePhoto(ctx));
    bot.on('message:text', (ctx) => this.messageHandler.handleText(ctx));

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
  private async publishIdentity(bot: Bot<BotContext>): Promise<void> {
    try {
      const me = await bot.api.getMe();
      if (!me.username) return;
      await this.apiClient.publishBotIdentity(me.username);
      this.logger.log(`Bot identity published: @${me.username}`);
    } catch (err) {
      this.logger.warn(`Failed to publish bot identity: ${(err as Error).message}`);
    }
  }

  private async logUpdate(ctx: BotContext, next: NextFunction): Promise<void> {
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

  private describeUpdate(ctx: BotContext): string {
    if (ctx.hasCommand('start')) return 'command /start';
    if (ctx.hasCommand('help')) return 'command /help';
    if (ctx.hasCommand('language')) return 'command /language';
    const callbackData = ctx.callbackQuery?.data;
    if (callbackData) return `callback_query "${callbackData}"`;
    const document = ctx.message?.document;
    if (document) {
      const size = document.file_size ? ` ${document.file_size}B` : '';
      return `document "${document.file_name ?? 'file'}"${size}`;
    }
    if (ctx.message?.photo) return 'photo';
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
