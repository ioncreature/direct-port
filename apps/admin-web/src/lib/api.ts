'use client';

import axios from 'axios';
import type { AuthResponse } from './types';

const api = axios.create({ baseURL: '/api' });

let isRefreshing = false;
let refreshPromise: Promise<string> | null = null;

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('accessToken');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

api.interceptors.response.use(
  (res) => res,
  async (error) => {
    const original = error.config;
    if (error.response?.status !== 401 || original._retry) {
      return Promise.reject(error);
    }

    original._retry = true;

    if (!isRefreshing) {
      isRefreshing = true;
      const refreshToken = localStorage.getItem('refreshToken');

      if (!refreshToken) {
        clearAuth();
        return Promise.reject(error);
      }

      refreshPromise = axios
        .post<AuthResponse>('/api/auth/refresh', { refreshToken })
        .then((res) => {
          const { accessToken, refreshToken: newRefresh } = res.data;
          localStorage.setItem('accessToken', accessToken);
          localStorage.setItem('refreshToken', newRefresh);
          return accessToken;
        })
        .catch(() => {
          clearAuth();
          return '';
        })
        .finally(() => {
          isRefreshing = false;
          refreshPromise = null;
        });
    }

    const token = await refreshPromise;
    if (!token) return Promise.reject(error);

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
