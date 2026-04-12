export interface User {
  id: string;
  email: string;
  role: 'admin' | 'customs';
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface AuthResponse {
  accessToken: string;
  refreshToken: string;
  user: Pick<User, 'id' | 'email' | 'role'>;
}

export interface TelegramUser {
  id: string;
  telegramId: string;
  username: string | null;
  firstName: string | null;
  lastName: string | null;
  createdAt: string;
  documentCount?: number;
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
  dutySign: string | null;
  dutyMin: number | null;
  dutyMinUnit: string | null;
  vatRate: number;
  exciseRate: number;
}

export interface TnVedSearchResultItem {
  code: string;
  description: string;
  count: number;
  rates: TnVedRateInfo;
}

export interface TnVedCodeDetail {
  code: string;
  description: string;
  rates: TnVedRateInfo;
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
  | 'parsing'
  | 'pending'
  | 'processing'
  | 'processed'
  | 'failed'
  | 'requires_review';

export interface ParsedDataRow {
  description: string;
  quantity: number;
  price: number;
  weight: number;
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

export interface DocumentResultRow {
  description: string;
  quantity: number;
  price: number;
  weight: number;
  tnVedCode: string;
  tnVedDescription: string;
  dutyRate: number;
  vatRate: number;
  exciseRate: number;
  totalPrice: number;
  dutyAmount: number;
  vatAmount: number;
  exciseAmount: number;
  logisticsCommission: number;
  totalCost: number;
  verificationStatus: 'exact' | 'review';
  matchConfidence: number;
  calculationStatus?: CalculationStatus;
  dutyAmountIsEstimate?: boolean;
  dutyFormula?: string | null;
  notes?: ProductNote[];
}

export type SortOrder = 'ASC' | 'DESC';

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
}

export interface Document {
  id: string;
  telegramUser: TelegramUser | null;
  uploadedBy: { id: string; email: string } | null;
  originalFileName: string;
  status: DocumentStatus;
  rowCount: number;
  currency: string | null;
  columnMapping: Record<string, number>;
  parsedData: ParsedDataRow[] | null;
  resultData: DocumentResultRow[] | null;
  errorMessage: string | null;
  tokenUsage: TokenUsageByStage | null;
  createdAt: string;
  updatedAt: string;
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
}

export interface CalculationLogSummary {
  grandTotal: number;
  totalDuty: number;
  totalVat: number;
  totalExcise: number;
  totalLogistics: number;
  currency: string;
}

export interface CalculationLog {
  id: string;
  documentId: string | null;
  telegramUserId: string | null;
  telegramUsername: string | null;
  fileName: string | null;
  itemsCount: number;
  resultSummary: CalculationLogSummary | null;
  createdAt: string;
}
