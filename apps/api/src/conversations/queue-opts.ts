import type { JobsOptions } from 'bullmq';

/**
 * Политика ретраев «доставочных» очередей managed-флоу (client-bot-outgoing,
 * manager-notifications). Сбой постановки НЕ глотается вызывающими — intake/реплай
 * отвечают 500, и отправитель видит ошибку вместо ложного «доставлено». Ретраи
 * самой доставки: боты пробрасывают временные ошибки Telegram (429/5xx/сеть),
 * неисправимые (бот заблокирован) уходят в failed без повторов.
 */
export const DELIVERY_JOB_OPTS: JobsOptions = {
  attempts: 5,
  backoff: { type: 'exponential', delay: 5_000 },
};
