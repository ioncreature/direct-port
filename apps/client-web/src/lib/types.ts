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

export interface Paginated<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
}
