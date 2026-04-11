'use client';

import { login as apiLogin, logout as apiLogout, getStoredUser } from '@/lib/auth';
import type { User } from '@/lib/types';
import { createContext, useCallback, useEffect, useState, type ReactNode } from 'react';

type AuthUser = Pick<User, 'id' | 'email' | 'role'> | null;

interface AuthContextValue {
  user: AuthUser;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

export const AuthContext = createContext<AuthContextValue>({
  user: null,
  loading: true,
  login: async () => {},
  logout: async () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setUser(getStoredUser());
    setLoading(false);
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const res = await apiLogin(email, password);
    setUser(res.user);
  }, []);

  const logout = useCallback(async () => {
    await apiLogout();
    setUser(null);
  }, []);

  return <AuthContext value={{ user, loading, login, logout }}>{children}</AuthContext>;
}
