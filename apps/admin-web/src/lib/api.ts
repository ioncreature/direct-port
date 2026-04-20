'use client';

import axios from 'axios';
import type { AuthResponse } from './types';

export const API_FORBIDDEN_EVENT = 'api:forbidden';

const api = axios.create({ baseURL: '/api' });

// Buffer for clock skew + time between exp check and server validation.
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
  if (isRefreshing && refreshPromise) {
    return refreshPromise;
  }
  const refreshToken = localStorage.getItem('refreshToken');
  if (!refreshToken) {
    return Promise.resolve('');
  }
  isRefreshing = true;
  refreshPromise = axios
    .post<AuthResponse>('/api/auth/refresh', { refreshToken })
    .then((res) => {
      const { accessToken, refreshToken: newRefresh } = res.data;
      localStorage.setItem('accessToken', accessToken);
      localStorage.setItem('refreshToken', newRefresh);
      return accessToken;
    })
    .catch(() => '')
    .finally(() => {
      isRefreshing = false;
      refreshPromise = null;
    });
  return refreshPromise;
}

api.interceptors.request.use(async (config) => {
  const token = localStorage.getItem('accessToken');
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

    if (error.response?.status === 403) {
      window.dispatchEvent(new Event(API_FORBIDDEN_EVENT));
    }

    if (error.response?.status !== 401 || original._retry) {
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

function clearAuth() {
  localStorage.removeItem('accessToken');
  localStorage.removeItem('refreshToken');
  localStorage.removeItem('user');
  window.location.href = '/login';
}

export default api;
