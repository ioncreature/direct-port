import { Injectable, Logger } from '@nestjs/common';
import { ApiClientService } from '../../api-client/api-client.service';
import { formatUser } from '../format-user';
import { type BotContext } from '../i18n';
import { CLARIFY_STEP, ConversationStateService } from '../state/conversation-state.service';

// Экспортируется, чтобы NotificationHandler собирал callback_data из тех же констант, что
// и парсит RowClarifyHandler — без этого опечатка ломает flow без TS-проверки.
export const CLARIFY_CALLBACK_PREFIX = 'clarify_';
export const CLARIFY_ACTION = {
  TEXT: 'clarify_text',
  CODE: 'clarify_code',
  SKIP: 'clarify_skip',
} as const;

// Telegram при копировании из <code>…</code> на части клиентов вставляет невидимые
// маркеры (ZWSP/ZWNJ/ZWJ, WJ, BOM), которые String.prototype.trim() не убирает и
// ломают strict-regex /^\d{10}$/ при ручном вводе кода ТН ВЭД.
const INVISIBLE_CHARS_RE = /[\s\u200B-\u200D\u2060\uFEFF]/g;

@Injectable()
export class RowClarifyHandler {
  private logger = new Logger(RowClarifyHandler.name);

  constructor(
    private apiClient: ApiClientService,
    private stateService: ConversationStateService,
  ) {}

  /** Возвращает true, если callback относится к clarify-flow (потреблён). */
  async handleCallback(ctx: BotContext): Promise<boolean> {
    const data = ctx.callbackQuery?.data;
    if (!data?.startsWith(CLARIFY_CALLBACK_PREFIX)) return false;

    const chatId = ctx.chat?.id;
    if (!chatId) {
      await ctx.answerCallbackQuery();
      return true;
    }
    const user = formatUser(ctx);

    // Format: `<action>:<docId>:<rowIdx>`. action может быть multi-word через `_`.
    const colonIdx = data.indexOf(':');
    if (colonIdx === -1) {
      await ctx.answerCallbackQuery();
      return true;
    }
    const action = data.slice(0, colonIdx);
    const tail = data.slice(colonIdx + 1).split(':');
    const documentId = tail[0] ?? '';
    const rowIndex = Number(tail[1] ?? 'NaN');

    if (!documentId || Number.isNaN(rowIndex)) {
      await ctx.answerCallbackQuery({ text: ctx.t('row-clarify-error') });
      return true;
    }

    const language = ctx.from?.language_code ?? 'en';

    if (action === CLARIFY_ACTION.TEXT || action === CLARIFY_ACTION.CODE) {
      const step =
        action === CLARIFY_ACTION.TEXT ? CLARIFY_STEP.TEXT : CLARIFY_STEP.CODE;
      await this.stateService.setClarifyState(chatId, {
        step,
        documentId,
        rowIndex,
        language,
      });
      await ctx.answerCallbackQuery();
      const promptKey =
        action === CLARIFY_ACTION.TEXT
          ? 'row-clarify-input-text-prompt'
          : 'row-clarify-input-code-prompt';
      await ctx.reply(ctx.t(promptKey, { row: String(rowIndex + 1) }));
      this.logger.log(
        `Row clarify ${action} requested by ${user}: doc=${documentId} row=${rowIndex}`,
      );
      return true;
    }

    if (action === CLARIFY_ACTION.SKIP) {
      await ctx.answerCallbackQuery({ text: ctx.t('row-clarify-skipped') });
      // Снимаем кнопки с карточки, чтобы клиент не вернулся к ней повторно.
      await ctx.editMessageReplyMarkup(undefined).catch(() => {
        /* сообщение уже могло быть отредактировано или удалено */
      });
      this.logger.log(`Row clarify skipped by ${user}: doc=${documentId} row=${rowIndex}`);
      return true;
    }

    await ctx.answerCallbackQuery();
    return true;
  }

  /** Возвращает true, если text сообщение потреблено clarify-flow. */
  async handleText(ctx: BotContext): Promise<boolean> {
    const chatId = ctx.chat?.id;
    if (!chatId) return false;
    const state = await this.stateService.getClarifyState(chatId);
    if (!state) return false;
    const text = ctx.message?.text?.trim();
    if (!text) return false;

    const user = formatUser(ctx);
    const { documentId, rowIndex, step } = state;

    try {
      if (step === CLARIFY_STEP.TEXT) {
        if (text.length < 2) {
          await ctx.reply(ctx.t('row-clarify-text-too-short'));
          return true;
        }
        await this.apiClient.clarifyRow(documentId, rowIndex, text);
        await ctx.reply(ctx.t('row-clarify-applied-text', { row: String(rowIndex + 1) }));
        this.logger.log(
          `Row clarify text applied by ${user}: doc=${documentId} row=${rowIndex} note=${text.length}ch`,
        );
      } else if (step === CLARIFY_STEP.CODE) {
        const cleaned = text.replace(INVISIBLE_CHARS_RE, '');
        if (!/^\d{10}$/.test(cleaned)) {
          await ctx.reply(ctx.t('row-clarify-invalid-code'));
          return true; // оставляем state — клиент попробует снова
        }
        await this.apiClient.setRowCode(documentId, rowIndex, cleaned);
        await ctx.reply(
          ctx.t('row-clarify-applied-code', { row: String(rowIndex + 1), code: cleaned }),
        );
        this.logger.log(
          `Row code applied by ${user}: doc=${documentId} row=${rowIndex} code=${cleaned}`,
        );
      } else {
        return false;
      }
      await this.stateService.clearClarifyState(chatId);
      return true;
    } catch (err) {
      const msg = (err as { response?: { data?: unknown }; message: string }).message;
      this.logger.error(
        `Failed to apply clarify (doc=${documentId} row=${rowIndex}): ${msg}`,
      );
      await ctx.reply(ctx.t('row-clarify-error'));
      // state НЕ сбрасываем — клиент может попробовать ещё раз.
      return true;
    }
  }
}
