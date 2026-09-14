import { create } from 'zustand';
import { User } from '../types/auth.types.js';
import { authService } from '../services/auth.service.js';
import { getAccessToken } from '../services/api.js';

interface AuthState {
  user: User | null;
  accessToken: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  error: string | null;
  login: (email: string, password: string) => Promise<boolean>;
  register: (name: string, email: string, password: string) => Promise<boolean>;
  logout: () => Promise<void>;
  initAuth: () => Promise<void>;
  clearError: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  accessToken: getAccessToken(),
  isAuthenticated: !!getAccessToken(),
  isLoading: true,
  error: null,

  clearError: () => set({ error: null }),

  login: async (email: string, password: string): Promise<boolean> => {
    set({ isLoading: true, error: null });
    try {
      const res = await authService.login(email, password);
      if (res.success && res.data) {
        set({
          user: res.data.user,
          accessToken: res.data.accessToken,
          isAuthenticated: true,
          isLoading: false,
          error: null,
        });
        return true;
      } else {
        set({
          error: res.error?.message || 'Login failed. Please check your credentials.',
          isLoading: false,
        });
        return false;
      }
    } catch (err: unknown) {
      set({
        error: err instanceof Error ? err.message : 'Network error during login',
        isLoading: false,
      });
      return false;
    }
  },

  register: async (name: string, email: string, password: string): Promise<boolean> => {
    set({ isLoading: true, error: null });
    try {
      const res = await authService.register(name, email, password);
      if (res.success && res.data) {
        set({
          user: res.data.user,
          accessToken: res.data.accessToken,
          isAuthenticated: true,
          isLoading: false,
          error: null,
        });
        return true;
      } else {
        set({
          error: res.error?.message || 'Registration failed.',
          isLoading: false,
        });
        return false;
      }
    } catch (err: unknown) {
      set({
        error: err instanceof Error ? err.message : 'Network error during registration',
        isLoading: false,
      });
      return false;
    }
  },

  logout: async () => {
    set({ isLoading: true });
    try {
      await authService.logout();
    } finally {
      set({
        user: null,
        accessToken: null,
        isAuthenticated: false,
        isLoading: false,
        error: null,
      });
    }
  },

  initAuth: async () => {
    const token = getAccessToken();
    if (!token) {
      // Try refresh cookie once
      try {
        const refreshRes = await authService.refresh();
        if (refreshRes.success && refreshRes.data) {
          set({
            user: refreshRes.data.user,
            accessToken: refreshRes.data.accessToken,
            isAuthenticated: true,
            isLoading: false,
          });
          return;
        }
      } catch {
        // No valid session
      }
      set({ isLoading: false, isAuthenticated: false, user: null });
      return;
    }

    try {
      const res = await authService.getMe();
      if (res.success && res.data?.user) {
        set({
          user: res.data.user,
          isAuthenticated: true,
          isLoading: false,
        });
      } else {
        // Access token might be expired, try refresh
        const refreshRes = await authService.refresh();
        if (refreshRes.success && refreshRes.data) {
          set({
            user: refreshRes.data.user,
            accessToken: refreshRes.data.accessToken,
            isAuthenticated: true,
            isLoading: false,
          });
        } else {
          set({ user: null, accessToken: null, isAuthenticated: false, isLoading: false });
        }
      }
    } catch {
      set({ user: null, accessToken: null, isAuthenticated: false, isLoading: false });
    }
  },
}));
