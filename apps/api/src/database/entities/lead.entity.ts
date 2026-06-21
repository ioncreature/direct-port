import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * Статус лида в sales-воронке DirectPort.
 *
 * Две «оси» в одном перечислении: pipeline-обогащение
 * (`new` → `enriching` → `enriched`/`failed`) и движение по воронке менеджером
 * (`enriched` → `in_progress` → `contacted` → `qualified`/`rejected`).
 */
export enum LeadStatus {
  /** Создан (discovery/импорт/вручную), ожидает обогащения либо обогащение ещё не требовалось. */
  NEW = 'new',
  /** Воркер lead-enrichment забрал лид. */
  ENRICHING = 'enriching',
  /** Обогащён AI — контакты и скоринг проставлены, готов к обзвону. */
  ENRICHED = 'enriched',
  /** Менеджер взял лид в работу. */
  IN_PROGRESS = 'in_progress',
  /** Состоялось касание (звонок/письмо). */
  CONTACTED = 'contacted',
  /** Целевой лид — реально импортирует, нужен расчёт пошлин. */
  QUALIFIED = 'qualified',
  /** Не наша ЦА / отказ. */
  REJECTED = 'rejected',
  /** Обогащение упало невосстановимо. */
  FAILED = 'failed',
}

export const leadStatusLabels: Record<LeadStatus, string> = {
  [LeadStatus.NEW]: 'Новый',
  [LeadStatus.ENRICHING]: 'Обогащение',
  [LeadStatus.ENRICHED]: 'Обогащён',
  [LeadStatus.IN_PROGRESS]: 'В работе',
  [LeadStatus.CONTACTED]: 'Связались',
  [LeadStatus.QUALIFIED]: 'Квалифицирован',
  [LeadStatus.REJECTED]: 'Отклонён',
  [LeadStatus.FAILED]: 'Ошибка',
};

/** Откуда лид попал в базу. */
export type LeadSource = 'fts_registry' | 'web_search' | 'manual' | 'import';

export const LEAD_SOURCES: readonly LeadSource[] = [
  'fts_registry',
  'web_search',
  'manual',
  'import',
];

const nullableScoreTransformer = {
  to: (value: number | null | undefined) => value ?? null,
  from: (value: string | null) => (value === null ? null : parseFloat(value)),
};

@Entity('leads')
@Index('idx_leads_status', ['status'])
@Index('idx_leads_domain', ['domain'])
export class Lead {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 500, name: 'company_name' })
  companyName: string;

  @Column({ type: 'varchar', length: 500, nullable: true })
  website: string | null;

  /** Нормализованный домен (lower-case, без www/протокола) — ключ дедупликации. */
  @Column({ type: 'varchar', length: 255, nullable: true })
  domain: string | null;

  @Column({ type: 'varchar', length: 12, nullable: true })
  inn: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  city: string | null;

  @Column({ type: 'jsonb', nullable: true })
  phones: string[] | null;

  @Column({ type: 'jsonb', nullable: true })
  emails: string[] | null;

  /** Услуги/направления деятельности, извлечённые с сайта. */
  @Column({ type: 'jsonb', nullable: true })
  services: string[] | null;

  /** Признак реального импорта/ВЭД (null — ещё не обогащён). */
  @Column({ type: 'boolean', name: 'does_import', nullable: true })
  doesImport: boolean | null;

  /** Направления импорта (Китай, Турция, Европа …). */
  @Column({ type: 'jsonb', name: 'import_directions', nullable: true })
  importDirections: string[] | null;

  /** Оценка релевантности для DirectPort, 0..1 (проставляет enrichment). */
  @Column({
    type: 'decimal',
    precision: 3,
    scale: 2,
    name: 'relevance_score',
    nullable: true,
    transformer: nullableScoreTransformer,
  })
  relevanceScore: number | null;

  /** Обоснование скоринга — заготовка для первой строки холодного письма. */
  @Column({ type: 'text', name: 'relevance_reason', nullable: true })
  relevanceReason: string | null;

  @Column({ type: 'enum', enum: LeadStatus, default: LeadStatus.NEW })
  status: LeadStatus;

  @Column({ type: 'varchar', length: 20 })
  source: LeadSource;

  /** Деталь источника: поисковый запрос (web_search) или метка реестра/файла. */
  @Column({ type: 'varchar', length: 500, name: 'source_detail', nullable: true })
  sourceDetail: string | null;

  /** Заметки менеджера по обзвону. */
  @Column({ type: 'text', nullable: true })
  notes: string | null;

  @Column({ type: 'timestamptz', name: 'last_contacted_at', nullable: true })
  lastContactedAt: Date | null;

  @Column({ type: 'text', name: 'error_message', nullable: true })
  errorMessage: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  get statusLabel(): string {
    return leadStatusLabels[this.status] ?? this.status;
  }

  toJSON() {
    return { ...this, statusLabel: this.statusLabel };
  }
}
