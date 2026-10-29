import { apiFetch, getAccessToken } from './api.js';
import { ApiResponse } from '../types/auth.types.js';
import { FileItem, PaginatedFilesResponse } from '../types/file.types.js';

export interface ListFilesOptions {
  folderId?: string | null;
  page?: number;
  limit?: number;
  sortBy?: 'name' | 'size' | 'createdAt' | 'updatedAt';
  sortOrder?: 'asc' | 'desc';
}

export const fileService = {
  /**
   * Uploads a file with multipart/form-data streaming
   */
  async uploadFile(file: File, folderId?: string | null): Promise<ApiResponse<{ file: FileItem }>> {
    const formData = new FormData();
    formData.append('file', file);
    if (folderId && folderId !== 'root') {
      formData.append('folderId', folderId);
    }

    const query = folderId && folderId !== 'root' ? `?folderId=${encodeURIComponent(folderId)}` : '';

    return apiFetch<{ file: FileItem }>(`/api/v1/files${query}`, {
      method: 'POST',
      body: formData,
    });
  },

  /**
   * Lists files with optional folder filtering and pagination
   */
  async listFiles(options: ListFilesOptions = {}): Promise<ApiResponse<PaginatedFilesResponse>> {
    const params = new URLSearchParams();

    if (options.folderId !== undefined) {
      params.set('folderId', options.folderId || 'root');
    }
    if (options.page) {
      params.set('page', options.page.toString());
    }
    if (options.limit) {
      params.set('limit', options.limit.toString());
    }
    if (options.sortBy) {
      params.set('sortBy', options.sortBy);
    }
    if (options.sortOrder) {
      params.set('sortOrder', options.sortOrder);
    }

    const queryString = params.toString() ? `?${params.toString()}` : '';
    return apiFetch<PaginatedFilesResponse>(`/api/v1/files${queryString}`);
  },

  /**
   * Retrieves single file metadata
   */
  async getFile(fileId: string): Promise<ApiResponse<{ file: FileItem }>> {
    return apiFetch<{ file: FileItem }>(`/api/v1/files/${fileId}`);
  },

  /**
   * Renames a file
   */
  async renameFile(fileId: string, name: string): Promise<ApiResponse<{ file: FileItem }>> {
    return apiFetch<{ file: FileItem }>(`/api/v1/files/${fileId}`, {
      method: 'PATCH',
      body: JSON.stringify({ name }),
    });
  },

  /**
   * Moves a file to another folder or root
   */
  async moveFile(fileId: string, targetFolderId: string | null): Promise<ApiResponse<{ file: FileItem }>> {
    return apiFetch<{ file: FileItem }>(`/api/v1/files/${fileId}/move`, {
      method: 'POST',
      body: JSON.stringify({ targetFolderId }),
    });
  },

  /**
   * Soft deletes a file
   */
  async deleteFile(fileId: string): Promise<ApiResponse<{ message: string }>> {
    return apiFetch<{ message: string }>(`/api/v1/files/${fileId}`, {
      method: 'DELETE',
    });
  },

  /**
   * Triggers a streaming file download with authentication
   */
  async downloadFile(fileId: string, fileName: string): Promise<void> {
    const token = getAccessToken();
    const headers = new Headers();
    if (token) {
      headers.set('Authorization', `Bearer ${token}`);
    }

    const response = await fetch(`/api/v1/files/${fileId}/download`, {
      method: 'GET',
      headers,
      credentials: 'include',
    });

    if (!response.ok) {
      let errorMsg = 'Failed to download file';
      try {
        const errorJson = await response.json();
        errorMsg = errorJson.error?.message || errorMsg;
      } catch {
        // Fallback
      }
      throw new Error(errorMsg);
    }

    const blob = await response.blob();
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.URL.revokeObjectURL(url);
  },
};
