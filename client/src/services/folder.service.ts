import { apiFetch } from './api.js';
import { ApiResponse } from '../types/auth.types.js';
import { Folder, BreadcrumbItem, CreateFolderInput } from '../types/folder.types.js';

export const folderService = {
  async createFolder(input: CreateFolderInput): Promise<ApiResponse<{ folder: Folder }>> {
    return apiFetch<{ folder: Folder }>('/api/v1/folders', {
      method: 'POST',
      body: JSON.stringify(input),
    });
  },

  async getFolder(folderId: string): Promise<ApiResponse<{ folder: Folder | { _id: string; name: string; isRoot: boolean }; breadcrumbs: BreadcrumbItem[] }>> {
    return apiFetch<{ folder: Folder; breadcrumbs: BreadcrumbItem[] }>(`/api/v1/folders/${folderId}`);
  },

  async getFolderChildren(folderId: string): Promise<ApiResponse<{ folders: Folder[] }>> {
    return apiFetch<{ folders: Folder[] }>(`/api/v1/folders/${folderId}/children`);
  },

  async renameFolder(folderId: string, name: string): Promise<ApiResponse<{ folder: Folder }>> {
    return apiFetch<{ folder: Folder }>(`/api/v1/folders/${folderId}`, {
      method: 'PATCH',
      body: JSON.stringify({ name }),
    });
  },

  async deleteFolder(folderId: string): Promise<ApiResponse<{ message: string }>> {
    return apiFetch<{ message: string }>(`/api/v1/folders/${folderId}`, {
      method: 'DELETE',
    });
  },

  async moveFolder(folderId: string, targetParentId: string | null): Promise<ApiResponse<{ folder: Folder }>> {
    return apiFetch<{ folder: Folder }>(`/api/v1/folders/${folderId}/move`, {
      method: 'POST',
      body: JSON.stringify({ targetParentId }),
    });
  },

  async getAllFolders(): Promise<ApiResponse<{ folders: Folder[] }>> {
    return apiFetch<{ folders: Folder[] }>('/api/v1/folders/all');
  },
};
