export interface User {
  _id: string;
  name: string;
  email: string;
  avatar?: string;
  storageQuota: number;
  storageUsed: number;
  role: 'user' | 'admin';
  isVerified: boolean;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface AuthResponse {
  user: User;
  accessToken: string;
  refreshToken?: string;
}

export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
    details?: unknown;
  };
}
