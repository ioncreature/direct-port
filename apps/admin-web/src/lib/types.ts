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
}

export type DocumentStatus = 'pending' | 'processing' | 'processed' | 'failed';

export interface Document {
  id: string;
  telegramUser: TelegramUser;
  originalFileName: string;
  status: DocumentStatus;
  rowCount: number;
  columnMapping: Record<string, number>;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
}
