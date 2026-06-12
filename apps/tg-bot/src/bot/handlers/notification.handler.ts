import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Job } from 'bullmq';
import { Api, InlineKeyboard, InputFile } from 'grammy';
import { ApiClientService } from '../../api-client/api-client.service';
import { i18n, tErrorCode } from '../i18n';
import { CLARIFY_ACTION } from './row-clarify.handler';

const ROW_DESC_MAX_LEN = 120;
const CANDIDATE_DESC_MAX_LEN = 80;
// Telegram режет сообщение на ~30 msg/sec на бота. Документы с десятками проблемных
// строк надо схлопывать — иначе rate-limit съедает часть карточек, и пользователь
// видит дыры в потоке.
const MAX_PROBLEM_CARDS = 20;

// Должен совпадать с ProblemRowSummary в apps/api/src/documents/notification.ts —
// тип передаётся через wire-payload BullMQ, отдельного shared package пока нет.
export interface ProblemRowSummary {
  rowIndex: number;
  description: string;
  tnVedCode?: string;
  matchConfidence?: number;
  missingDataCategories?: string[];
  candidateCodes?: Array<{
    code: string;
    description: string;
    confidence: number;
    dutyRate: number;
    vatRate: number;
  }>;
}

interface DocumentNotification {
  documentId: string;
  telegramUserId: string;
  status:
    | 'processed'
    | 'processed_with_errors'
    | 'failed'
    | 'rejected'
    | 'code_review_required'
    | 'stage_classifying';
  errorMessage?: string;
  errorCode?: string;
  rejectionReasons?: string[];
  rejectionReasonsLocalized?: string[];
  itemCount?: number;
  problemRows?: ProblemRowSummary[];
  language?: string;
  outputFileName?: string;
  sendResultFile?: boolean;
}

/** Уведомления старше суток не доставляем — они давно неактуальны для пользователя. */
const MAX_NOTIFICATION_AGE_MS = 24 * 3600_000;

@Injectable()
@Processor('document-notifications')
export class NotificationHandler extends WorkerHost {
  private logger = new Logger(NotificationHandler.name);
  private tgApi: Api | null;

  constructor(
    config: ConfigService,
    private apiClient: ApiClientService,
  ) {
    super();
    const token = config.get<string>('TELEGRAM_BOT_TOKEN');
    this.tgApi = token ? new Api(token) : null;
  }

  private t(lang: string | undefined, key: string, args?: Record<string, string>): string {
    return i18n.t(lang || 'en', key, args);
  }

  async process(job: Job<DocumentNotification>): Promise<void> {
    const {
      documentId,
      telegramUserId,
      status,
      errorMessage,
      errorCode,
      rejectionReasons,
      rejectionReasonsLocalized,
      itemCount,
      language,
      outputFileName,
      sendResultFile,
    } = job.data;
    this.logger.log(`Notification for document ${documentId}: ${status}`);

    // tg-bot выведен из автозапуска (deprecated): пока консьюмера нет, jobs копятся
    // в waiting. При временном включении бота без этого порога весь накопленный
    // backlog устаревших «готово»/«ошибка» разом улетел бы пользователям.
    const age = Date.now() - job.timestamp;
    if (age > MAX_NOTIFICATION_AGE_MS) {
      this.logger.warn(
        `Skipping stale notification for document ${documentId} (${Math.round(age / 3600_000)}h old)`,
      );
      return;
    }

    if (!this.tgApi) {
      this.logger.warn('Bot token not configured, skipping notification');
      return;
    }

    const chatId = telegramUserId;

    if (status === 'stage_classifying') {
      await this.tgApi
        .sendMessage(
          chatId,
          this.t(language, 'notif-stage-classifying', { count: String(itemCount ?? 0) }),
        )
        .catch((err) => this.logger.error(`Failed to send stage notification to ${chatId}`, err));
      return;
    }

    if (status === 'rejected') {
      const reasons = rejectionReasonsLocalized ?? rejectionReasons ?? [];
      const reasonsList =
        reasons.length > 0
          ? reasons.map((r, i) => `${i + 1}. ${r}`).join('\n')
          : this.t(language, 'notif-rejected-default');

      await this.tgApi
        .sendMessage(chatId, this.t(language, 'notif-rejected', { reasons: reasonsList }))
        .catch((err) =>
          this.logger.error(`Failed to send rejection notification to ${chatId}`, err),
        );
      return;
    }

    if (status === 'failed') {
      const detail = errorCode
        ? tErrorCode(language, errorCode, 'notif-failed-retry')
        : errorMessage ?? this.t(language, 'notif-failed-retry');
      await this.tgApi
        .sendMessage(chatId, this.t(language, 'notif-failed', { detail }))
        .catch((err) => this.logger.error(`Failed to send error notification to ${chatId}`, err));
      return;
    }

    if (status === 'processed_with_errors') {
      await this.tgApi
        .sendMessage(chatId, this.t(language, 'notif-processed-with-errors'))
        .catch((err) =>
          this.logger.error(`Failed to send partial-error notification to ${chatId}`, err),
        );
      return;
    }

    if (status === 'code_review_required') {
      const rows = job.data.problemRows ?? [];
      // Старый продьюсер мог не положить problemRows — fallback к простому сообщению.
      if (rows.length === 0) {
        await this.tgApi
          .sendMessage(chatId, this.t(language, 'notif-code-review-required'))
          .catch((err) =>
            this.logger.error(`Failed to send code-review notification to ${chatId}`, err),
          );
        return;
      }
      await this.tgApi
        .sendMessage(
          chatId,
          this.t(language, 'notif-code-review-intro', { count: String(rows.length) }),
        )
        .catch((err) =>
          this.logger.error(`Failed to send code-review intro to ${chatId}`, err),
        );
      const cards = rows.slice(0, MAX_PROBLEM_CARDS);
      const overflow = rows.length - cards.length;
      await Promise.allSettled(
        cards.map((row) =>
          this.sendProblemRowCard(chatId, documentId, row, language).catch((err) =>
            this.logger.error(
              `Failed to send row ${row.rowIndex} card for doc ${documentId}: ${(err as Error).message}`,
            ),
          ),
        ),
      );
      if (overflow > 0) {
        await this.tgApi
          .sendMessage(
            chatId,
            this.t(language, 'notif-code-review-overflow', { count: String(overflow) }),
          )
          .catch((err) =>
            this.logger.error(`Failed to send code-review overflow to ${chatId}`, err),
          );
      }
      return;
    }

    if (sendResultFile === false) {
      await this.tgApi
        .sendMessage(chatId, this.t(language, 'notif-success-contact'))
        .catch((err) =>
          this.logger.error(`Failed to send contact notification to ${chatId}`, err),
        );
      return;
    }

    try {
      const fileBuffer = await this.apiClient.downloadDocument(documentId);

      const fileName = outputFileName || `result_${documentId}.xlsx`;
      await this.tgApi.sendDocument(
        chatId,
        new InputFile(fileBuffer, fileName),
        { caption: this.t(language, 'notif-success') },
      );
    } catch (err) {
      this.logger.error(`Failed to send result for document ${documentId}`, err);
      await this.tgApi.sendMessage(chatId, this.t(language, 'notif-send-failed'));
    }
  }

  private async sendProblemRowCard(
    chatId: string,
    documentId: string,
    row: ProblemRowSummary,
    language: string | undefined,
  ): Promise<void> {
    if (!this.tgApi) return;
    const text = this.buildProblemRowText(row, language);
    const kb = this.buildProblemRowKeyboard(documentId, row, language);
    await this.tgApi.sendMessage(chatId, text, {
      reply_markup: kb,
      parse_mode: 'HTML',
    });
  }

  private buildProblemRowText(row: ProblemRowSummary, language: string | undefined): string {
    const lines: string[] = [];
    lines.push(this.t(language, 'row-clarify-header', { row: String(row.rowIndex + 1) }));
    const desc = truncate(row.description, ROW_DESC_MAX_LEN);
    lines.push(
      this.t(language, 'row-clarify-description', { description: escapeHtml(desc) }),
    );
    if (row.tnVedCode) {
      const conf =
        row.matchConfidence != null ? `${Math.round(row.matchConfidence * 100)}%` : '?';
      lines.push(
        this.t(language, 'row-clarify-current-code', {
          code: row.tnVedCode,
          confidence: conf,
        }),
      );
    } else {
      lines.push(this.t(language, 'row-clarify-no-code'));
    }
    if (row.missingDataCategories && row.missingDataCategories.length > 0) {
      const labels = row.missingDataCategories
        .map((c) => this.t(language, `row-clarify-missing-${c}`))
        .filter((l) => l && !l.startsWith('row-clarify-missing-'))
        .join(', ');
      if (labels) {
        lines.push(this.t(language, 'row-clarify-missing-prompt', { categories: labels }));
      }
    }
    if (row.candidateCodes && row.candidateCodes.length > 0) {
      lines.push(this.t(language, 'row-clarify-candidates-header'));
      for (const c of row.candidateCodes) {
        const cdesc = truncate(c.description, CANDIDATE_DESC_MAX_LEN);
        lines.push(`<code>${c.code}</code> — ${escapeHtml(cdesc)}`);
      }
    }
    return lines.join('\n');
  }

  // callback_data Telegram ограничен 64 байтами — UUID(36) + action(~12) + index(~3) умещаются,
  // выбор кода из candidate-набора кодов в callback_data вместить нельзя без отдельного хранилища,
  // поэтому коды показаны моноширинным шрифтом для копирования.
  private buildProblemRowKeyboard(
    documentId: string,
    row: ProblemRowSummary,
    language: string | undefined,
  ): InlineKeyboard {
    const kb = new InlineKeyboard();
    kb.text(
      this.t(language, 'row-clarify-btn-text'),
      `${CLARIFY_ACTION.TEXT}:${documentId}:${row.rowIndex}`,
    ).row();
    kb.text(
      this.t(language, 'row-clarify-btn-code'),
      `${CLARIFY_ACTION.CODE}:${documentId}:${row.rowIndex}`,
    ).row();
    kb.text(
      this.t(language, 'row-clarify-btn-skip'),
      `${CLARIFY_ACTION.SKIP}:${documentId}:${row.rowIndex}`,
    ).row();
    return kb;
  }
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 3) + '...' : s;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
