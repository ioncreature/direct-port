'use client';

import axios from 'axios';
import type { ClientAuthResponse } from './types';

// Браузер всегда ходит в свой /api/* (проксируется в client-bff). Токены — в localStorage.
const api = axios.create({ baseURL: '/api' });

const LEEWAY_SECONDS = 10;

let isRefreshing = false;
let refreshPromise: Promise<string> | null = null;

function getJwtExp(token: string): number | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
    const payload = JSON.parse(atob(padded)) as { exp?: number };
    return typeof payload.exp === 'number' ? payload.exp : null;
  } catch {
    return null;
  }
}

function refreshAccessToken(): Promise<string> {
  if (isRefreshing && refreshPromise) return refreshPromise;
  const refreshToken = localStorage.getItem('clientRefreshToken');
  if (!refreshToken) return Promise.resolve('');
  isRefreshing = true;
  refreshPromise = axios
    .post<ClientAuthResponse>('/api/client/auth/refresh', { refreshToken })
    .then((res) => {
      localStorage.setItem('clientAccessToken', res.data.accessToken);
      localStorage.setItem('clientRefreshToken', res.data.refreshToken);
      return res.data.accessToken;
    })
    .catch(() => '')
    .finally(() => {
      isRefreshing = false;
      refreshPromise = null;
    });
  return refreshPromise;
}

api.interceptors.request.use(async (config) => {
  const token = localStorage.getItem('clientAccessToken');
  if (token) {
    const exp = getJwtExp(token);
    if (exp !== null && exp <= Date.now() / 1000 + LEEWAY_SECONDS) {
      const refreshed = await refreshAccessToken();
      if (refreshed) {
        config.headers.Authorization = `Bearer ${refreshed}`;
        return config;
      }
    }
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

api.interceptors.response.use(
  (res) => res,
  async (error) => {
    const original = error.config;
    if (error.response?.status !== 401 || original?._retry) {
      return Promise.reject(error);
    }
    original._retry = true;
    const token = await refreshAccessToken();
    if (!token) {
      clearAuth();
      return Promise.reject(error);
    }
    original.headers.Authorization = `Bearer ${token}`;
    return api(original);
  },
);

export function clearAuth() {
  localStorage.removeItem('clientAccessToken');
  localStorage.removeItem('clientRefreshToken');
  localStorage.removeItem('clientProfile');
  window.location.href = '/';
}

export default api;
