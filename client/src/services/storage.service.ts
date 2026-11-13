import { apiFetch } from './api.js';
import { ApiResponse } from '../types/auth.types.js';
import { StorageUsageStats } from '../types/storage.types.js';

export const storageService = {
  /**
   * Get storage usage statistics for the authenticated user
   */
  async getStorageUsage(): Promise<ApiResponse<StorageUsageStats>> {
    return apiFetch<StorageUsageStats>('/api/v1/storage/usage');
  },

  /**
   * Update storage quota for the authenticated user
   */
  async updateStorageQuota(storageQuota: number): Promise<ApiResponse<StorageUsageStats>> {
    return apiFetch<StorageUsageStats>('/api/v1/storage/quota', {
      method: 'PATCH',
      body: JSON.stringify({ storageQuota }),
    });
  },
};
