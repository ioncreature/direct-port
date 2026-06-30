/**
 * Канал Redis pub/sub, на который api публикует изменения токенов ботов компаний, а client-bot и
 * manager-bot подписаны для динамического подъёма/перезапуска/остановки бота без передеплоя.
 * Имя канала продублировано в обоих ботах (отдельные приложения, общей библиотеки нет — как
 * DEFAULT_COMPANY_ID). См. docs/COMPANY_BOTS.md.
 */
import { type BotKind } from '../bot-links/dto/publish-bot-identity.dto';

export const BOT_CONFIG_CHANNEL = 'bot-config-events';

export interface BotConfigEvent {
  companyId: string;
  kind: BotKind;
  /** upsert — токен добавлен/изменён (поднять/перезапустить бот); remove — токен убран (остановить). */
  action: 'upsert' | 'remove';
}
