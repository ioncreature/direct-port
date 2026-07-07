import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/** Происхождение записи: manual — код выбран оператором; auto — уверенная AI-классификация
 *  из успешно завершённого расчёта. manual не перезаписывается auto-записью. */
export type ClientProductCodeSource = 'manual' | 'auto';

/**
 * Каталог подтверждённых кодов ТН ВЭД клиента — «память» о его ассортименте.
 * Повторная поставка тех же товаров (типовой кейс логистической компании) находит код
 * здесь и минует AI-классификацию и TKS-поиск целиком: дешевле, быстрее и, главное,
 * коды не «прыгают» между поставками. Ключ — sha256 нормализованного описания + артикула
 * (ClientCodeCatalogService.buildProductKey), скоуп — клиент внутри компании.
 *
 * Писатели: ManualCodeService.setRowCode (source=manual) и DocumentsProcessor после
 * успешного прогона (source=auto, только строки verificationStatus='exact').
 * Читатель: DocumentsProcessor перед классификацией (codeSource='catalog' у хитов).
 */
@Entity('client_product_codes')
@Index('uq_client_product_codes_key', ['companyId', 'telegramUserId', 'productKey'], {
  unique: true,
})
export class ClientProductCode {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', name: 'company_id' })
  companyId: string;

  @Column({ type: 'uuid', name: 'telegram_user_id' })
  telegramUserId: string;

  /** sha256-hex нормализованного описания + артикула — стабильный ключ повторной поставки. */
  @Column({ type: 'varchar', length: 64, name: 'product_key' })
  productKey: string;

  /** Описание на момент подтверждения — для просмотра каталога человеком. */
  @Column({ type: 'text' })
  description: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  article: string | null;

  @Column({ type: 'varchar', length: 20, name: 'tn_ved_code' })
  tnVedCode: string;

  @Column({ type: 'varchar', length: 12 })
  source: ClientProductCodeSource;

  /** Уверенность на момент подтверждения: manual — 1, auto — confidence классификатора. */
  @Column({ type: 'float', name: 'match_confidence' })
  matchConfidence: number;

  @Column({ type: 'int', name: 'times_used', default: 0 })
  timesUsed: number;

  @Column({ type: 'timestamptz', name: 'last_used_at', nullable: true })
  lastUsedAt: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
