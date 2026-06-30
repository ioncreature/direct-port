import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Bot, type NextFunction } from 'grammy';
import Redis from 'ioredis';
import { ApiClientService } from '../api-client/api-client.service';
import {
  BotRegistry,
  BOT_CONFIG_CHANNEL,
  DEFAULT_COMPANY_ID,
  type BotConfigEvent,
  type RegisteredBot,
} from './bot-registry.service';
import { formatUser } from './format-user';
import { FileUploadHandler } from './handlers/file-upload.handler';
import { HelpHandler } from './handlers/help.handler';
import { LanguageHandler } from './handlers/language.handler';
import { MessageHandler } from './handlers/message.handler';
import { StartHandler } from './handlers/start.handler';
import { type BotContext, i18n, SUPPORTED_LOCALES } from './i18n';
import { ConversationStateService } from './state/conversation-state.service';

// Страховка от пропущенных pub/sub-событий (рестарт Redis/бота) — периодический реконсайл.
const RECONCILE_INTERVAL_MS = 5 * 60 * 1000;

/**
 * Поднимает клиентские боты: дефолтный из env TELEGRAM_BOT_TOKEN (привязан к дефолтной компании)
 * и по одному боту на каждую компанию с заведённым токеном (GET /internal/bots). Подписан на
 * Redis-канал изменений токенов — поднимает/перезапускает/останавливает боты компаний без
 * передеплоя. Реестр (Api по companyId) использует OutgoingHandler. См. docs/COMPANY_BOTS.md.
 */
@Injectable()
export class BotService implements OnModuleInit, OnModuleDestroy {
  private logger = new Logger(BotService.name);
  private subscriber?: Redis;
  private reconcileTimer?: NodeJS.Timeout;

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
    }
    for (const entry of bots) this.startBot(entry);
    this.subscribeToConfigEvents();
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

  private addBot(companyId: string, token: string): RegisteredBot {
    const bot = new Bot<BotContext>(token);
    this.configure(bot, companyId);
    const entry: RegisteredBot = { companyId, bot, token };
    this.registry.register(entry);
    // Глобальную bot-link публикуем только для дефолтного бота; per-company identity — Фаза 2.
    if (companyId === DEFAULT_COMPANY_ID) void this.publishIdentity(bot);
    return entry;
  }

  private startBot(entry: RegisteredBot): void {
    // fire-and-forget: bot.start() резолвится только при остановке (long-polling loop).
    void entry.bot.start();
    this.logger.log(`Client bot started for company ${entry.companyId}`);
  }

  // --- Динамическое управление ботами компаний (Redis pub/sub + реконсайл) ---

  private subscribeToConfigEvents(): void {
    const url = this.config.get<string>('REDIS_URL', 'redis://localhost:6380');
    this.subscriber = new Redis(url);
    this.subscriber.on('error', (err) =>
      this.logger.warn(`Config subscriber error: ${err.message}`),
    );
    this.subscriber
      .subscribe(BOT_CONFIG_CHANNEL)
      .catch((err) =>
        this.logger.error(`Failed to subscribe to ${BOT_CONFIG_CHANNEL}: ${(err as Error).message}`),
      );
    this.subscriber.on('message', (_channel, raw) => void this.handleConfigEvent(raw));
    this.reconcileTimer = setInterval(() => void this.reconcile(), RECONCILE_INTERVAL_MS);
  }

  private async handleConfigEvent(raw: string): Promise<void> {
    let event: BotConfigEvent;
    try {
      event = JSON.parse(raw) as BotConfigEvent;
    } catch {
      return;
    }
    // client-bot слушает только клиентские боты; дефолтный поднимается из env, не из админки.
    if (event.kind !== 'client' || event.companyId === DEFAULT_COMPANY_ID) return;
    try {
      // upsert обрабатывает reconcile: он сравнит токены и поднимет/пересоздаст бот компании.
      if (event.action === 'remove') await this.removeCompanyBot(event.companyId);
      else await this.reconcile();
    } catch (err) {
      this.logger.error(
        `Failed to apply bot-config event for ${event.companyId}: ${(err as Error).message}`,
      );
    }
  }

  private async removeCompanyBot(companyId: string): Promise<void> {
    const entry = this.registry.remove(companyId);
    if (entry) {
      await entry.bot.stop().catch(() => undefined);
      this.logger.log(`Company client bot ${companyId} stopped`);
    }
  }

  /**
   * Сверяет реестр с api и приводит к нему: убирает исчезнувшие боты, поднимает недостающие и
   * пересоздаёт те, у кого сменился токен. Единственный путь синхронизации — его дёргают и
   * pub/sub-события (upsert), и периодический таймер; так пропущенное событие (в т.ч. ротация
   * токена) самозалечивается на ближайшем тике.
   */
  private async reconcile(): Promise<void> {
    let bots: Array<{ companyId: string; token: string }>;
    try {
      bots = await this.apiClient.listBots();
    } catch (err) {
      this.logger.warn(`Reconcile skipped: ${(err as Error).message}`);
      return;
    }
    const wanted = new Map(
      bots.filter((b) => b.companyId !== DEFAULT_COMPANY_ID).map((b) => [b.companyId, b.token]),
    );
    for (const entry of this.registry.all()) {
      if (entry.companyId !== DEFAULT_COMPANY_ID && !wanted.has(entry.companyId)) {
        await this.removeCompanyBot(entry.companyId);
      }
    }
    for (const [companyId, token] of wanted) {
      const existing = this.registry.get(companyId);
      if (existing?.token === token) continue; // не изменился
      if (existing) await this.removeCompanyBot(companyId); // токен сменился — пересоздаём
      this.startBot(this.addBot(companyId, token));
    }
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
    if (this.reconcileTimer) clearInterval(this.reconcileTimer);
    await this.subscriber?.quit().catch(() => undefined);
    await Promise.all(this.registry.all().map(({ bot }) => bot.stop().catch(() => undefined)));
  }
}
