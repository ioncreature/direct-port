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
