/** Ответ входа в кабинет (BFF /client/auth/telegram). */
export interface ClientAuthResponse {
  accessToken: string;
  refreshToken: string;
  client: ClientProfile;
}

export interface ClientProfile {
  name: string | null;
  username: string | null;
  photoUrl: string | null;
}

/** Профиль + баланс (BFF /client/me). */
export interface ClientMe extends ClientProfile {
  telegramUserId: string;
  balance: number;
}

export type DepositTransactionType = 'topup' | 'charge' | 'adjustment' | 'grant';

export interface DepositTransaction {
  id: string;
  delta: number;
  type: DepositTransactionType;
  balanceAfter: number;
  documentId: string | null;
  comment: string | null;
  createdByEmail: string | null;
  createdAt: string;
}

export interface ClientDocument {
  id: string;
  originalFileName: string;
  status: string;
  statusLabel: string;
  rowCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface ProductNote {
  stage: string;
  severity: 'info' | 'warning' | 'blocker';
  message: string;
  messageLocalized?: string;
  field?: string;
}

/** Строка resultData (CalculatedProduct) — подмножество полей для построчного показа. */
export interface CalculatedRow {
  description: string;
  quantity: number;
  price: number;
  weight: number;
  tnVedCode: string | null;
  tnVedDescription: string | null;
  dutyRateDisplay?: string | null;
  vatRate?: number | null;
  totalCost?: number;
  dutyAmountRub?: number;
  vatAmountRub?: number;
  exciseAmountRub?: number;
  logisticsCommissionRub?: number;
  totalCostRub?: number;
  calculationStatus?: string;
  notes?: ProductNote[];
}

export interface ClientDocumentDetail extends ClientDocument {
  currency: string | null;
  countryOfOrigin: string | null;
  errorMessage: string | null;
  rejectionReasons: string[] | null;
  resultData: CalculatedRow[] | null;
}

export interface Paginated<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
}

export interface TopUpPackage {
  key: string;
  positions: number;
  amount: number;
  perPosition: number;
  currency: string;
}

export type TopUpStatus = 'pending' | 'confirmed' | 'canceled';

export interface TopUpRequest {
  id: string;
  packageKey: string | null;
  positions: number;
  amount: number;
  currency: string;
  pricePerPosition: number;
  status: TopUpStatus;
  comment: string | null;
  createdAt: string;
  confirmedAt: string | null;
}
