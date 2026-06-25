'use client';

import api, { clearAuth } from './api';
import type { ClientAuthResponse, ClientProfile } from './types';

export interface TelegramAuthData {
  id: number;
  first_name?: string;
  last_name?: string;
  username?: string;
  photo_url?: string;
  auth_date: number;
  hash: string;
}

/** Логин через данные Telegram Login Widget → выдача и сохранение client-сессии. */
export async function loginWithTelegram(data: TelegramAuthData): Promise<ClientAuthResponse> {
  const { data: res } = await api.post<ClientAuthResponse>('/client/auth/telegram', data);
  localStorage.setItem('clientAccessToken', res.accessToken);
  localStorage.setItem('clientRefreshToken', res.refreshToken);
  localStorage.setItem('clientProfile', JSON.stringify(res.client));
  return res;
}

/** Выход = сброс сессии (та же очистка, что и при 401 в api-интерсепторе). */
export const logout = clearAuth;

export function isAuthenticated(): boolean {
  if (typeof window === 'undefined') return false;
  return !!localStorage.getItem('clientAccessToken');
}

export function getStoredProfile(): ClientProfile | null {
  if (typeof window === 'undefined') return null;
  const raw = localStorage.getItem('clientProfile');
  if (!raw) return null;
  try {
    return JSON.parse(raw) as ClientProfile;
  } catch {
    return null;
  }
}
