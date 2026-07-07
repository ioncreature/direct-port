export type UserRole = 'super_admin' | 'admin' | 'customs';

export interface User {
  id: string;
  email: string;
  role: UserRole;
  /** Компания пользователя. null только у super_admin. */
  companyId: string | null;
  /** Название компании. Приходит только в списке пользователей (GET /users); null у super_admin. */
  companyName?: string | null;
  isActive: boolean;
  managerTelegramId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AuthResponse {
  accessToken: string;
  refreshToken: string;
  user: Pick<User, 'id' | 'email' | 'role' | 'companyId'>;
}

/** Темы оформления админки под тенанта — синхронно с бэком (common/tenant/company-theme.ts). */
export const COMPANY_THEMES = ['default', 'sky', 'orbit'] as const;
export type CompanyTheme = (typeof COMPANY_THEMES)[number];

export interface Company {
  id: string;
  name: string;
  slug: string | null;
  /** Тема оформления админки под тенанта. */
  theme: CompanyTheme;
  /** sha256 логотипа: признак наличия и cache-busting превью; null — логотипа нет. */
  logoHash: string | null;
  /** sha256 favicon: признак наличия и cache-busting превью; null — своего favicon нет. */
  faviconHash: string | null;
  /** Домены тенанта (нормализованные host'ы). */
  domains: string[];
  createdAt: string;
  updatedAt: string;
}

/** Число привязанных к компании сущностей — блокируют удаление, показываются на её странице. */
export interface CompanyCounts {
  users: number;
  clients: number;
  documents: number;
}

/** Деталь компании (GET /companies/:id): компания + счётчики привязанных сущностей. */
export interface CompanyDetail extends Company {
  counts: CompanyCounts;
}

/** Статус ботов компании (без токенов) — для управления на странице компаний. */
export interface CompanyBotsStatus {
  client: { configured: boolean; username: string | null };
  manager: { configured: boolean; username: string | null };
}

export interface TelegramUser {
  id: string;
  telegramId: string;
  username: string | null;
  firstName: string | null;
  lastName: string | null;
  createdAt: string;
  documentCount?: number;
  assignedManagerId?: string | null;
  companyId?: string | null;
  /** Депозит клиента в «обработанных позициях». */
  balance?: number;
}

export type DepositTransactionType = 'topup' | 'charge' | 'adjustment';

export interface DepositTransaction {
  id: string;
  /** Изменение баланса: + пополнение/возврат, − списание. */
  delta: number;
  type: DepositTransactionType;
  balanceAfter: number;
  documentId: string | null;
  comment: string | null;
  createdByEmail: string | null;
  createdAt: string;
}

export interface ConversationMessage {
  id: string;
  clientId: string;
  direction: 'client_to_manager' | 'manager_to_client';
  managerId: string | null;
  manager?: { id: string; email: string } | null;
  text: string | null;
  attachmentType: 'document' | 'photo' | 'file' | null;
  attachmentFileId: string | null;
  documentId: string | null;
  createdAt: string;
}

export interface TnVedCode {
  id: number;
  code: string;
  description: string;
  unit: string | null;
  dutyRate: number;
  vatRate: number;
  exciseRate: number;
  parentCode: string | null;
  level: number;
}

export interface TnVedRateInfo {
  dutyRate: number;
  /** Единица IMP: null или "%" → dutyRate это адвалорный процент; "EUR/..." → специфическая ставка за единицу */
  dutyRateUnit: string | null;
  dutySign: string | null;
  dutyMin: number | null;
  dutyMinUnit: string | null;
  vatRate: number;
  exciseRate: number;
  /** Единица AKC: null/"%" → exciseRate адвалорный %; "RUB/л", "EUR/тыс.шт" → специфический акциз */
  exciseRateUnit: string | null;
  exciseSign: string | null;
  exciseMin: number | null;
  exciseMinUnit: string | null;
}

export interface TnVedExtendedRates {
  tempDuty: number | null;
  tempDutyUnit: string | null;
  antidumpingDuty: number | null;
  antidumpingDutyUnit: string | null;
  compensatoryDuty: number | null;
  compensatoryDutyUnit: string | null;
  additionalDuty: number | null;
  additionalUnits: string[];
}

export type TnVedCountryDutyKind = 'antidumping' | 'compensatory' | 'preferential';

export interface TnVedCountryDuty {
  kind: TnVedCountryDutyKind;
  countryCode: string | null;
  countryName: string | null;
  rate: number | null;
  rateUnit: string | null;
  sign: string | null;
  dateBegin: string | null;
  dateEnd: string | null;
  documentNumber: string | null;
  documentDate: string | null;
  note: string | null;
}

export interface TnVedConditionalExcise {
  rate: number | null;
  rateUnit: string | null;
  sign: string | null;
  dateBegin: string | null;
  dateEnd: string | null;
  documentNumber: string | null;
  documentDate: string | null;
  note: string | null;
}

export interface TnVedDeclarationExample {
  description: string;
  count: number;
}

export interface TnVedSearchResultItem {
  code: string;
  description: string;
  count: number;
  rates: TnVedRateInfo;
}

export type RegulatoryCategory =
  | 'certification'
  | 'permit_import'
  | 'permit_export'
  | 'license_import'
  | 'license_export'
  | 'marking'
  | 'traceability'
  | 'utilization'
  | 'strategic'
  | 'dual_use_import'
  | 'dual_use_export'
  | 'country_import_ban'
  | 'country_export_ban'
  | 'other';

export type AssessmentForm =
  | 'declaration'
  | 'certificate'
  | 'state_registration'
  | 'notification'
  | 'permit'
  | 'license'
  | 'fee'
  | 'unknown';

export type MatchPrecision = 'exact' | 'narrow' | 'broad';

export interface RegulatoryItem {
  id: string;
  category: RegulatoryCategory;
  priznak: number;
  title: string;
  summary: string;
  regulation: string | null;
  regulationTitle: string | null;
  form: AssessmentForm;
  authority: string | null;
  documentRef: { number: string; date: string | null } | null;
  validFrom: string | null;
  validTo: string | null;
  matchPrecision: MatchPrecision;
  codeRange: { min: string; max: string | null };
  countryCode: string | null;
  countryName: string | null;
  values: { min: number | null; max: number | null; unit: string | null };
  rawNote: string;
}

export interface RegulatoryReport {
  certifications: RegulatoryItem[];
  permits: RegulatoryItem[];
  licenses: RegulatoryItem[];
  marking: RegulatoryItem[];
  traceability: RegulatoryItem[];
  utilizationFee: RegulatoryItem[];
  strategicAndDualUse: RegulatoryItem[];
  countryRestrictions: RegulatoryItem[];
  other: RegulatoryItem[];
  totalCount: number;
}

export interface RegulatoryExplanation {
  summary: string;
  regulation: string | null;
  form: AssessmentForm | null;
  authority: string | null;
}

export interface TnVedCodeDetail {
  code: string;
  description: string;
  rates: TnVedRateInfo;
  extendedRates: TnVedExtendedRates;
  countryDuties: TnVedCountryDuty[];
  conditionalExcises: TnVedConditionalExcise[];
  declarations: TnVedDeclarationExample[];
  regulatoryReport: RegulatoryReport;
  dateBegin?: string;
  dateEnd?: string;
  notes?: string;
}

export interface TnVedSearchResponse {
  mode: 'code_lookup' | 'text_search';
  query: string;
  translatedQuery?: string;
  codeDetail?: TnVedCodeDetail;
  results: TnVedSearchResultItem[];
  totalFound: number;
}

export type DocumentStatus =
  | 'intake'
  | 'parsing'
  | 'pending'
  | 'processing'
  | 'processed'
  | 'processed_with_errors'
  | 'failed'
  | 'rejected'
  | 'requires_review'
  | 'code_review_required';

/**
 * Строка parsedData. В UI редактируются только description/quantity/price/weight,
 * но при сохранении ревью на сервер уходит строка ЦЕЛИКОМ: остальные поля
 * (weightGross, countryOfOrigin, attributes, dimensions…) извлечены AI-парсером
 * и должны пережить ручную правку нетронутыми — иначе фрахт/страновые ставки
 * считаются неверно. Index signature покрывает passthrough-поля.
 */
export interface ParsedDataRow {
  description: string;
  quantity: number;
  price: number;
  weight: number;
  [key: string]: unknown;
}

export type ProductNoteStage = 'parse' | 'classify' | 'verify' | 'interpret' | 'calculate';
export type ProductNoteSeverity = 'info' | 'warning' | 'blocker';

export interface ProductNote {
  stage: ProductNoteStage;
  severity: ProductNoteSeverity;
  message: string;
  messageLocalized?: string;
  field?: string;
}

export type CalculationStatus = 'exact' | 'partial' | 'needs_info' | 'error';

/**
 * Один из вариантов кода ТН ВЭД, который Claude рассматривал во время классификации.
 * Включает уже подгруженные ставки — оператор видит dutyRate/vatRate/exciseRate каждой
 * альтернативы без дополнительного запроса.
 */
export interface CodeCandidate {
  code: string;
  description: string;
  dutyRate: number;
  dutyRateUnit: string | null;
  vatRate: number;
  exciseRate: number;
  confidence: number;
  reasoning: string;
  reasoningLocalized?: string;
}

export interface DocumentResultRow {
  description: string;
  quantity: number;
  price: number;
  weight: number;
  /** OKSMT-код страны происхождения строки (перекрывает страну документа). */
  countryOfOrigin?: string | null;
  tnVedCode: string;
  tnVedDescription: string;
  dutyRate: number;
  vatRate: number;
  exciseRate: number;
  totalPrice: number;
  freightShare?: number;
  freightShareRub?: number;
  dutyAmount: number;
  vatAmount: number;
  exciseAmount: number;
  totalCost: number;
  verificationStatus: 'exact' | 'review';
  matchConfidence: number;
  calculationStatus?: CalculationStatus;
  dutyAmountIsEstimate?: boolean;
  dutyFormula?: string | null;
  notes?: ProductNote[];
  regulatoryReport?: RegulatoryReport | null;
  /**
   * Топ-3 кодов, между которыми Claude колебался в classify-стадии. Заполняется
   * только при низкой уверенности — оператор использует список как опору при
   * ручном выборе кода через `POST /documents/:id/rows/:index/set-code`.
   */
  candidateCodes?: CodeCandidate[] | null;
}

/**
 * Фото строки документа из GET /documents/:id/photos: миниатюра первого фото
 * (data-URI) + id всех фото строки для полноразмерного просмотра.
 * rowIndex — индекс строки в parsedData/resultData.
 */
export interface DocumentPhotoRow {
  rowIndex: number;
  photoIds: string[];
  thumb: string;
}

export type SortOrder = 'ASC' | 'DESC';

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
}

export type CountryOriginSource =
  | 'ai_explicit'
  | 'ai_language'
  | 'ai_currency'
  | 'manual'
  | 'default';

/** Условия поставки Инкотермс 2020 — совпадает с INCOTERMS в API. */
export const INCOTERMS = [
  'EXW',
  'FCA',
  'FAS',
  'FOB',
  'CFR',
  'CIF',
  'CPT',
  'CIP',
  'DAP',
  'DPU',
  'DDP',
] as const;
export type Incoterms = (typeof INCOTERMS)[number];

export interface Document {
  id: string;
  telegramUser: TelegramUser | null;
  uploadedBy: { id: string; email: string } | null;
  companyId?: string | null;
  originalFileName: string;
  status: DocumentStatus;
  source: 'self_service' | 'managed';
  rowCount: number;
  currency: string | null;
  exchangeRates: Record<string, number> | null;
  columnMapping: Record<string, number>;
  parsedData: ParsedDataRow[] | null;
  resultData: DocumentResultRow[] | null;
  errorMessage: string | null;
  rejectionReasons: string[] | null;
  tokenUsage: TokenUsageByStage | null;
  countryOfOrigin: string | null;
  countryOriginSource: CountryOriginSource | null;
  countryDetectionReason: string | null;
  /** Стоимость доставки до границы (общая для документа). Распределяется на позиции пропорционально весу брутто (fallback — нетто). */
  freightCost: number | null;
  /** Валюта freightCost. */
  freightCurrency: 'USD' | 'CNY' | 'RUB' | 'EUR' | null;
  /** Условия поставки Инкотермс 2020. null — не указаны. */
  incoterms: Incoterms | null;
  createdAt: string;
  updatedAt: string;
}

export interface Country {
  code: string;
  alpha2: string | null;
  alpha3: string | null;
  nameRu: string;
  nameFullRu: string | null;
  nameEn: string | null;
}

export type TokenUsageMap = Record<string, {
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens?: number;
  cacheReadTokens?: number;
}>;
export type TokenUsageByStage = Record<string, TokenUsageMap>;

export interface TokenStatsPeriod {
  models: TokenUsageMap;
  documentCount: number;
}

export interface TokenStatsUser {
  telegramUserId: string | null;
  username: string | null;
  firstName: string | null;
  models: TokenUsageMap;
  documentCount: number;
}

export interface TokenStatsDocument {
  id: string;
  originalFileName: string;
  tokenUsage: TokenUsageByStage | null;
  createdAt: string;
  telegramUsername: string | null;
}

export interface TokenStats {
  availableModels: string[];
  total: TokenStatsPeriod;
  today: TokenStatsPeriod;
  week: TokenStatsPeriod;
  month: TokenStatsPeriod;
  byUser: TokenStatsUser[];
  recentDocuments: TokenStatsDocument[];
  /** Расход на автопоиск лидов (всего). null — в скоупе конкретной компании
   *  (лиды платформенные, к компании не относятся). */
  leads: TokenUsageMap | null;
}

/** Ответ /documents/token-stats/monthly: общий месячный итог + расход на лиды за месяц. */
export interface MonthlyTokenStats extends TokenStatsPeriod {
  leads: TokenUsageMap | null;
}

export interface DailyTokenStats {
  date: string;
  models: TokenUsageMap;
}

export interface CalculationLogSummary {
  grandTotal: number;
  totalDuty: number;
  totalVat: number;
  totalExcise: number;
  currency: string;
}

export type CalculationTrigger = 'full' | 'recalculate';

export interface CalculationLog {
  id: string;
  itemsCount: number;
  resultSummary: CalculationLogSummary | null;
  trigger: CalculationTrigger;
  createdAt: string;
}

export type PipelineStage = 'parse' | 'classify' | 'interpret' | 'calculate';
export type PipelineStageStatus = 'running' | 'ok' | 'partial_ok' | 'failed';

export type AiCallPurpose =
  | 'parse_structure'
  | 'parse_products'
  | 'parse_chunk'
  | 'parse_validate'
  | 'classify_formulate_queries'
  | 'classify'
  | 'classify_retry'
  | 'classify_vision'
  | 'interpret'
  | 'translate_query'
  | 'regulatory_interpret';

export interface AiCallError {
  message: string;
  stack?: string;
  code?: string;
}

export interface AiCallLite {
  id: string;
  stageRunId: string | null;
  documentId: string | null;
  purpose: AiCallPurpose;
  model: string;
  attempt: number;
  error: AiCallError | null;
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  latencyMs: number | null;
  startedAt: string;
  finishedAt: string | null;
}

export interface AiCall extends AiCallLite {
  request: unknown;
  response: unknown;
}

export interface PipelineStageRun {
  id: string;
  documentId: string;
  stage: PipelineStage;
  attempt: number;
  status: PipelineStageStatus;
  startedAt: string;
  finishedAt: string | null;
  durationMs: number | null;
  output: unknown;
  error: AiCallError | null;
  tokenUsage: TokenUsageMap | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
  aiCalls: AiCallLite[];
}

export type DocumentVersionReason = 'ai_parse' | 'manual_edit' | 'reprocess';
export type DocumentVersionActorType = 'system' | 'user' | 'telegram';

export interface DocumentVersionLite {
  id: string;
  documentId: string;
  version: number;
  reason: DocumentVersionReason;
  actorType: DocumentVersionActorType | null;
  actorId: string | null;
  createdAt: string;
}

export interface DocumentVersionSnapshot {
  parsedData: ParsedDataRow[] | null;
  currency: string | null;
  columnMapping: Record<string, number> | null;
}

export interface DocumentVersion extends DocumentVersionLite {
  snapshot: DocumentVersionSnapshot;
}

export type LeadStatus =
  | 'new'
  | 'enriching'
  | 'enriched'
  | 'in_progress'
  | 'contacted'
  | 'qualified'
  | 'rejected'
  | 'failed';

export type LeadSource = 'fts_registry' | 'web_search' | 'manual' | 'import';

export type LeadSearchStatus = 'running' | 'completed' | 'failed';

export interface LeadSearch {
  id: string;
  query: string;
  city: string | null;
  maxResults: number;
  status: LeadSearchStatus;
  foundCount: number;
  createdCount: number;
  skippedCount: number;
  errorMessage: string | null;
  createdAt: string;
  finishedAt: string | null;
}

export interface Lead {
  id: string;
  companyName: string;
  website: string | null;
  domain: string | null;
  inn: string | null;
  city: string | null;
  phones: string[] | null;
  emails: string[] | null;
  services: string[] | null;
  doesImport: boolean | null;
  importDirections: string[] | null;
  relevanceScore: number | null;
  relevanceReason: string | null;
  status: LeadStatus;
  statusLabel: string;
  source: LeadSource;
  sourceDetail: string | null;
  notes: string | null;
  lastContactedAt: string | null;
  errorMessage: string | null;
  /** Клиент, в которого сконвертировался лид (написал в бот). null — ещё не клиент. */
  convertedTelegramUserId: string | null;
  convertedAt: string | null;
  convertedClient?: Pick<
    TelegramUser,
    'id' | 'telegramId' | 'username' | 'firstName' | 'lastName'
  > | null;
  createdAt: string;
  updatedAt: string;
}

// ---------- Дашборд ----------

/** Окно статистики дашборда: последние 7/30/365 дней. */
export type DashboardPeriod = 'week' | 'month' | 'year';

export interface DashboardSeriesPoint {
  /** YYYY-MM-DD (granularity=day) или YYYY-MM (granularity=month). */
  date: string;
  documents: number;
  positions: number;
}

/** Ответ GET /dashboard/stats. users/ai — null для роли customs. */
export interface DashboardStats {
  period: DashboardPeriod;
  granularity: 'day' | 'month';
  documents: { total: number; byStatus: Partial<Record<DocumentStatus, number>> };
  positions: { total: number; successful: number; customsPaymentsRub: number };
  /** Качество классификации за период: точные коды vs проверка, каталог клиента, ручные. */
  quality: {
    exact: number;
    review: number;
    fromCatalog: number;
    manualCodes: number;
    avgMatchConfidence: number | null;
  };
  clients: { total: number; new: number; active: number };
  billing: {
    totalBalance: number;
    topUpPositions: number;
    chargedPositions: number;
    pendingTopUps: number;
  };
  users: number | null;
  ai: { models: TokenUsageMap; leads: TokenUsageMap | null } | null;
  series: DashboardSeriesPoint[];
  recentDocuments: Array<Pick<Document, 'id' | 'originalFileName' | 'status' | 'createdAt'>>;
}
