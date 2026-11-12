import { apiFetch } from './api.js';
import { ApiResponse } from '../types/auth.types.js';
import { PaginatedTrashResponse, ListTrashOptions } from '../types/trash.types.js';

export const trashService = {
  /**
   * Lists deleted files and folders with pagination and type filtering
   */
  async listTrash(options: ListTrashOptions = {}): Promise<ApiResponse<PaginatedTrashResponse>> {
    const params = new URLSearchParams();
    if (options.type) {
      params.set('type', options.type);
    }
    if (options.page) {
      params.set('page', options.page.toString());
    }
    if (options.limit) {
      params.set('limit', options.limit.toString());
    }

    const queryString = params.toString() ? `?${params.toString()}` : '';
    return apiFetch<PaginatedTrashResponse>(`/api/v1/trash${queryString}`);
  },

  /**
   * Restores an item (file or folder) from trash
   */
  async restoreItem(itemId: string): Promise<ApiResponse<{ message: string; restoredItem: Record<string, unknown> }>> {
    return apiFetch<{ message: string; restoredItem: Record<string, unknown> }>(`/api/v1/trash/${itemId}/restore`, {
      method: 'POST',
    });
  },

  /**
   * Permanently deletes a single item from trash
   */
  async permanentlyDeleteItem(itemId: string): Promise<ApiResponse<{ message: string }>> {
    return apiFetch<{ message: string }>(`/api/v1/trash/${itemId}/permanent`, {
      method: 'DELETE',
    });
  },

  /**
   * Empties all items from the trash
   */
  async emptyTrash(): Promise<ApiResponse<{ message: string; deletedFilesCount: number; deletedFoldersCount: number }>> {
    return apiFetch<{ message: string; deletedFilesCount: number; deletedFoldersCount: number }>('/api/v1/trash/empty', {
      method: 'DELETE',
    });
  },
};
