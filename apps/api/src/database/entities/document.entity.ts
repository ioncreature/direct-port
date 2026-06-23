import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import type { TokenUsageByStage } from '../../common/token-usage';
import { TelegramUser } from './telegram-user.entity';
import { User } from './user.entity';

export enum DocumentStatus {
  INTAKE = 'intake',
  PARSING = 'parsing',
  PENDING = 'pending',
  PROCESSING = 'processing',
  PROCESSED = 'processed',
  PROCESSED_WITH_ERRORS = 'processed_with_errors',
  FAILED = 'failed',
  REQUIRES_REVIEW = 'requires_review',
  CODE_REVIEW_REQUIRED = 'code_review_required',
  REJECTED = 'rejected',
}

export const documentStatusLabels: Record<DocumentStatus, string> = {
  [DocumentStatus.INTAKE]: 'Входящий',
  [DocumentStatus.PARSING]: 'Распознавание',
  [DocumentStatus.PENDING]: 'Ожидает обработки',
  [DocumentStatus.PROCESSING]: 'Обработка',
  [DocumentStatus.PROCESSED]: 'Обработан',
  [DocumentStatus.PROCESSED_WITH_ERRORS]: 'Обработан с ошибками',
  [DocumentStatus.FAILED]: 'Ошибка',
  [DocumentStatus.REQUIRES_REVIEW]: 'Требует проверки',
  [DocumentStatus.CODE_REVIEW_REQUIRED]: 'Требует проверки кодов',
  [DocumentStatus.REJECTED]: 'Отклонён',
};

/** Источник страны происхождения для документа.
 *  - ai_explicit  — AI нашёл явное упоминание страны в тексте
 *  - ai_language  — определено по языку описания
 *  - ai_currency  — определено по валюте документа
 *  - manual       — указано оператором в админке
 *  - default      — ничего не определили, применён Китай как дефолт
 */
export type CountryOriginSource =
  | 'ai_explicit'
  | 'ai_language'
  | 'ai_currency'
  | 'manual'
  | 'default';

/** Источник документа:
 *  - self_service — legacy (бывший tg-bot, удалён) + загрузки из админки (upload-admin),
 *                   пайплайн стартует автоматически; уведомлений клиенту нет
 *  - managed       — клиент через client-bot, пайплайн запускает менеджер вручную (статус INTAKE) */
export type DocumentSource = 'self_service' | 'managed';

export const DEFAULT_COUNTRY_OF_ORIGIN = '156'; // Китай (OKSMT)

/** Поддерживаемые валюты для freightCost. Допустимые символьные коды совпадают с ЦБ РФ. */
export type FreightCurrency = 'USD' | 'CNY' | 'RUB' | 'EUR';
export const FREIGHT_CURRENCIES: readonly FreightCurrency[] = ['USD', 'CNY', 'RUB', 'EUR'];

const nullableDecimalTransformer = {
  to: (value: number | null | undefined) => value ?? null,
  from: (value: string | null) => (value === null ? null : parseFloat(value)),
};

@Entity('documents')
export class Document {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', name: 'telegram_user_id', nullable: true })
  telegramUserId: string | null;

  @Column({ type: 'uuid', name: 'uploaded_by_user_id', nullable: true })
  uploadedByUserId: string | null;

  /** Компания (тенант) документа. Денормализовано для фильтрации списков и статистики.
   *  upload-admin → компания загрузившего; managed/self_service → компания telegram-клиента
   *  (NULL пока клиент не взят менеджером, наследуется при claim). */
  @Column({ type: 'uuid', name: 'company_id', nullable: true })
  companyId: string | null;

  /** self_service (автозапуск пайплайна) | managed (запуск менеджером вручную). */
  @Column({ type: 'varchar', length: 16, default: 'self_service' })
  source: DocumentSource;

  @Column({ type: 'varchar', length: 500, name: 'original_file_name' })
  originalFileName: string;

  @Column({ type: 'enum', enum: DocumentStatus, default: DocumentStatus.PENDING })
  status: DocumentStatus;

  @Column({ type: 'bytea', name: 'file_buffer', nullable: true, select: false })
  fileBuffer: Buffer | null;

  @Column({ type: 'jsonb', name: 'column_mapping', nullable: true })
  columnMapping: Record<string, number> | null;

  @Column({ type: 'varchar', length: 10, nullable: true })
  currency: string | null;

  @Column({ type: 'jsonb', name: 'exchange_rates', nullable: true })
  exchangeRates: Record<string, number> | null;

  @Column({ type: 'varchar', length: 5, nullable: true })
  language: string | null;

  @Column({ type: 'varchar', length: 3, name: 'country_of_origin', nullable: true })
  countryOfOrigin: string | null;

  @Column({ type: 'varchar', length: 16, name: 'country_origin_source', nullable: true })
  countryOriginSource: CountryOriginSource | null;

  @Column({ type: 'text', name: 'country_detection_reason', nullable: true })
  countryDetectionReason: string | null;

  /** Общая стоимость доставки до границы (фрахт). Распределяется по позициям пропорционально
   *  весу нетто (weight × qty) и включается в таможенную стоимость для расчёта пошлины/НДС. */
  @Column({
    type: 'decimal',
    precision: 14,
    scale: 4,
    name: 'freight_cost',
    nullable: true,
    transformer: nullableDecimalTransformer,
  })
  freightCost: number | null;

  /** Валюта freightCost (USD/CNY/RUB/EUR). Конвертируется в валюту документа по курсу ЦБ РФ. */
  @Column({ type: 'varchar', length: 3, name: 'freight_currency', nullable: true })
  freightCurrency: FreightCurrency | null;

  @Column({ type: 'jsonb', name: 'parsed_data', nullable: true })
  parsedData: Record<string, unknown>[] | null;

  @Column({ type: 'jsonb', name: 'result_data', nullable: true })
  resultData: Record<string, unknown>[] | null;

  @Column({ type: 'int', name: 'row_count', default: 0 })
  rowCount: number;

  /** Сколько позиций уже списано с депозита клиента за этот документ. Делает списание
   *  идемпотентным: reprocess/recalculate сверяют новое число успешных позиций с уже
   *  списанным и доводят разницу, а не списывают повторно (ClientBalanceService.settle). */
  @Column({ type: 'int', name: 'balance_charged_amount', default: 0 })
  balanceChargedAmount: number;

  @Column({ type: 'text', name: 'error_message', nullable: true })
  errorMessage: string | null;

  @Column({ type: 'jsonb', name: 'rejection_reasons', nullable: true })
  rejectionReasons: string[] | null;

  @Column({ type: 'jsonb', name: 'token_usage', nullable: true })
  tokenUsage: TokenUsageByStage | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  @ManyToOne(() => TelegramUser, (user) => user.documents, { nullable: true, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'telegram_user_id' })
  telegramUser: TelegramUser | null;

  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'uploaded_by_user_id' })
  uploadedBy: User | null;

  get statusLabel(): string {
    return documentStatusLabels[this.status] ?? this.status;
  }

  toJSON() {
    return { ...this, statusLabel: this.statusLabel };
  }
}
