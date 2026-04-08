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

export type DocumentStatus = 'parsing' | 'pending' | 'processing' | 'processed' | 'failed' | 'requires_review';

export interface ParsedDataRow {
  description: string;
  quantity: number;
  price: number;
  weight: number;
}

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
  createdAt: string;
  updatedAt: string;
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
