import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Bot, type NextFunction } from 'grammy';
import { formatUser } from './format-user';
import { CallbackQueryHandler } from './handlers/callback-query.handler';
import { FileUploadHandler } from './handlers/file-upload.handler';
import { HelpHandler } from './handlers/help.handler';
import { LanguageHandler } from './handlers/language.handler';
import { MenuHandler } from './handlers/menu.handler';
import { CLARIFY_CALLBACK_PREFIX, RowClarifyHandler } from './handlers/row-clarify.handler';
import { StartHandler } from './handlers/start.handler';
import { type BotContext, i18n, SUPPORTED_LOCALES } from './i18n';
import { ConversationStateService } from './state/conversation-state.service';

// Тексты старой reply-кнопки «Загрузить файл» (ключ btn-upload удалён). Хардкодим
// явно, чтобы можно было ловить нажатия у клиентов с закешированной legacy-клавой
// и заменять её актуальной версией.
const LEGACY_UPLOAD_TEXTS = ['📁 Загрузить файл', '📁 Upload file', '📁 上传文件'];

@Injectable()
export class BotService implements OnModuleInit, OnModuleDestroy {
  private logger = new Logger(BotService.name);
  private bot: Bot<BotContext>;

  constructor(
    private config: ConfigService,
    private startHandler: StartHandler,
    private helpHandler: HelpHandler,
    private menuHandler: MenuHandler,
    private fileUploadHandler: FileUploadHandler,
    private callbackQueryHandler: CallbackQueryHandler,
    private languageHandler: LanguageHandler,
    private rowClarifyHandler: RowClarifyHandler,
    private stateService: ConversationStateService,
  ) {
    const token = this.config.get<string>('TELEGRAM_BOT_TOKEN');
    if (!token) {
      this.logger.warn('TELEGRAM_BOT_TOKEN not set, bot will not start');
      this.bot = null as unknown as Bot<BotContext>;
      return;
    }
    this.bot = new Bot<BotContext>(token);
  }

  async onModuleInit() {
    if (!this.bot) return;

    this.bot.use((ctx, next) => this.logUpdate(ctx, next));

    // i18n middleware
    this.bot.use(i18n.middleware());

    // Restore locale from Redis state
    this.bot.use(async (ctx, next) => {
      const chatId = ctx.chat?.id;
      if (chatId) {
        const state = await this.stateService.getState(chatId);
        if (state?.language) {
          ctx.i18n.useLocale(state.language);
        }
      }
      return next();
    });

    // Reply keyboard text handlers — match all locale variants
    const helpTexts = SUPPORTED_LOCALES.map((l) => i18n.t(l, 'btn-help'));
    this.bot.hears(helpTexts, (ctx) => this.menuHandler.handleHelp(ctx));

    // Legacy «Upload file» reply-кнопка удалена, но у клиентов, получивших
    // /start до деплоя, она ещё видна. Перехватываем старые тексты, чтобы при
    // нажатии переслать обновлённую клавиатуру и тем самым стереть legacy.
    this.bot.hears(LEGACY_UPLOAD_TEXTS, (ctx) =>
      this.menuHandler.handleLegacyUpload(ctx),
    );

    // Commands
    this.bot.command('start', (ctx) => this.startHandler.handle(ctx));
    this.bot.command('help', (ctx) => this.helpHandler.handle(ctx));
    this.bot.command('language', (ctx) => this.languageHandler.handleCommand(ctx));

    // Callback queries
    this.bot.on('callback_query:data', async (ctx) => {
      const data = ctx.callbackQuery.data;
      if (data.startsWith('lang_')) {
        return this.languageHandler.handleCallback(ctx);
      }
      if (data.startsWith(CLARIFY_CALLBACK_PREFIX)) {
        await this.rowClarifyHandler.handleCallback(ctx);
        return;
      }
      return this.callbackQueryHandler.handle(ctx);
    });

    // Document upload
    this.bot.on('message:document', (ctx) => this.fileUploadHandler.handle(ctx));

    this.bot.on('message:text', async (ctx) => {
      await this.rowClarifyHandler.handleText(ctx);
    });

    this.bot.catch((err) => {
      const ctx = err.ctx;
      const user = formatUser(ctx);
      this.logger.error(
        `Bot error for update ${ctx.update.update_id}${user ? ' from ' + user : ''}: ${err.message}`,
        err.error instanceof Error ? err.error.stack : undefined,
      );
    });

    this.bot.start();
    this.logger.log('Telegram bot started');
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

    const text = ctx.message?.text;
    if (text) {
      const preview = text.length > 50 ? text.slice(0, 50) + '...' : text;
      return `text "${preview}"`;
    }

    const photo = ctx.message?.photo;
    if (photo) return 'photo';

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
