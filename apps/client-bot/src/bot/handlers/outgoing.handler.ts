import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { Job, UnrecoverableError } from 'bullmq';
import { Api, InputFile } from 'grammy';
import { ApiClientService } from '../../api-client/api-client.service';
import { BotRegistry } from '../bot-registry.service';
import { i18n } from '../i18n';
import { isPermanentDeliveryError } from '../telegram-errors';

// Wire-format: совпадает с ClientOutgoingMessage в apps/api/src/conversations/client-outgoing.ts.
interface ClientOutgoingMessage {
  companyId?: string;
  clientTelegramId: string;
  language?: string;
  text?: string;
  documentId?: string;
  documentFileName?: string;
  i18nKey?: string;
}

/** Доставляет клиенту ответы менеджера (очередь client-bot-outgoing): текст или готовый расчёт. */
@Injectable()
@Processor('client-bot-outgoing')
export class OutgoingHandler extends WorkerHost {
  private logger = new Logger(OutgoingHandler.name);

  constructor(
    private apiClient: ApiClientService,
    private registry: BotRegistry,
  ) {
    super();
  }

  async process(job: Job<ClientOutgoingMessage>): Promise<void> {
    const { companyId, clientTelegramId, text, documentId, documentFileName, language, i18nKey } =
      job.data;
    // Доставляем через бот компании клиента (по companyId); дефолтный — fallback.
    const api = this.registry.getApi(companyId);
    if (!api) {
      // failed-job виден в Redis — лучше, чем «успешно» проглоченный ответ менеджера.
      throw new UnrecoverableError('No client bot available to deliver outgoing message');
    }
    if (documentId) {
      await this.deliverDocument(api, clientTelegramId, documentId, documentFileName, language);
      return;
    }
    // Системные уведомления приходят ключом локали — переводим их на язык клиента здесь.
    const body = i18nKey ? i18n.t(language ?? 'ru', i18nKey) : text;
    if (!body) return;
    try {
      await api.sendMessage(clientTelegramId, body);
    } catch (err) {
      this.rethrowDeliveryError(err, `manager message to ${clientTelegramId}`);
    }
  }

  /** Скачивает Excel результата из API и отправляет клиенту как документ с локализованной подписью. */
  private async deliverDocument(
    api: Api,
    clientTelegramId: string,
    documentId: string,
    fileName: string | undefined,
    language: string | undefined,
  ): Promise<void> {
    try {
      const buffer = await this.apiClient.downloadDocument(documentId);
      const caption = i18n.t(language ?? 'ru', 'result-ready');
      await api.sendDocument(clientTelegramId, new InputFile(buffer, fileName ?? 'result.xlsx'), {
        caption,
      });
    } catch (err) {
      this.rethrowDeliveryError(err, `result document to ${clientTelegramId}`);
    }
  }

  /**
   * Потерянный ответ менеджера хуже повторной попытки: раньше любая ошибка Telegram
   * глоталась с логом, job завершался «успешно», и клиент молча не получал сообщение,
   * хотя менеджер видел «✅ Отправлено». Временные сбои (429/5xx/сеть) пробрасываем —
   * BullMQ ретраит по attempts продюсера; неисправимые (бот заблокирован клиентом,
   * документ удалён) переводим в UnrecoverableError — job уходит в failed без ретраев
   * и остаётся виден в Redis.
   */
  private rethrowDeliveryError(err: unknown, what: string): never {
    if (isPermanentDeliveryError(err)) {
      this.logger.error(`Permanently failed to deliver ${what}: ${(err as Error).message}`);
      throw new UnrecoverableError(`Delivery permanently failed (${what}): ${(err as Error).message}`);
    }
    this.logger.warn(`Transient failure delivering ${what}, will retry: ${(err as Error).message}`);
    throw err;
  }
}
