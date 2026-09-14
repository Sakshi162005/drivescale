import { apiFetch, setAccessToken } from './api.js';
import { ApiResponse, AuthResponse, User } from '../types/auth.types.js';

export const authService = {
  async register(name: string, email: string, password: string): Promise<ApiResponse<AuthResponse>> {
    const res = await apiFetch<AuthResponse>('/api/v1/auth/register', {
      method: 'POST',
      body: JSON.stringify({ name, email, password }),
    });

    if (res.success && res.data?.accessToken) {
      setAccessToken(res.data.accessToken);
    }
    return res;
  },

  async login(email: string, password: string): Promise<ApiResponse<AuthResponse>> {
    const res = await apiFetch<AuthResponse>('/api/v1/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });

    if (res.success && res.data?.accessToken) {
      setAccessToken(res.data.accessToken);
    }
    return res;
  },

  async logout(): Promise<void> {
    try {
      await apiFetch('/api/v1/auth/logout', {
        method: 'POST',
      });
    } finally {
      setAccessToken(null);
    }
  },

  async getMe(): Promise<ApiResponse<{ user: User }>> {
    return apiFetch<{ user: User }>('/api/v1/auth/me');
  },

  async refresh(): Promise<ApiResponse<AuthResponse>> {
    const res = await apiFetch<AuthResponse>('/api/v1/auth/refresh', {
      method: 'POST',
    });

    if (res.success && res.data?.accessToken) {
      setAccessToken(res.data.accessToken);
    } else {
      setAccessToken(null);
    }
    return res;
  },
};
