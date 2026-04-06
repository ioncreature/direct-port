'use client';

import api from './api';
import type { AuthResponse, User } from './types';

export async function login(email: string, password: string): Promise<AuthResponse> {
  const { data } = await api.post<AuthResponse>('/auth/login', { email, password });
  localStorage.setItem('accessToken', data.accessToken);
  localStorage.setItem('refreshToken', data.refreshToken);
  localStorage.setItem('user', JSON.stringify(data.user));
  return data;
}

export async function logout(): Promise<void> {
  const refreshToken = localStorage.getItem('refreshToken');
  if (refreshToken) {
    try {
      await api.post('/auth/logout', { refreshToken });
    } catch {
      // ignore
    }
  }
  localStorage.removeItem('accessToken');
  localStorage.removeItem('refreshToken');
  localStorage.removeItem('user');
}

export function getStoredUser(): Pick<User, 'id' | 'email' | 'role'> | null {
  if (typeof window === 'undefined') return null;
  const raw = localStorage.getItem('user');
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function isAuthenticated(): boolean {
  if (typeof window === 'undefined') return false;
  return !!localStorage.getItem('accessToken');
}
