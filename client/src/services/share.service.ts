import { apiFetch } from './api.js';
import { ApiResponse } from '../types/auth.types.js';
import {
  ShareItem,
  PaginatedSharedResponse,
  SharedFolderContentsResponse,
  CreateShareInput,
  UpdateShareInput,
  ShareResourceType,
} from '../types/share.types.js';

export const shareService = {
  // File sharing
  async shareFile(fileId: string, input: CreateShareInput): Promise<ApiResponse<{ share: ShareItem }>> {
    return apiFetch<{ share: ShareItem }>(`/api/v1/shares/files/${fileId}`, {
      method: 'POST',
      body: JSON.stringify(input),
    });
  },

  async getFileShares(fileId: string): Promise<ApiResponse<{ shares: ShareItem[] }>> {
    return apiFetch<{ shares: ShareItem[] }>(`/api/v1/shares/files/${fileId}`, {
      method: 'GET',
    });
  },

  async updateFileShare(
    fileId: string,
    shareId: string,
    input: UpdateShareInput
  ): Promise<ApiResponse<{ share: ShareItem }>> {
    return apiFetch<{ share: ShareItem }>(`/api/v1/shares/files/${fileId}/${shareId}`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    });
  },

  async revokeFileShare(
    fileId: string,
    shareId: string
  ): Promise<ApiResponse<{ message: string; revoked: boolean }>> {
    return apiFetch<{ message: string; revoked: boolean }>(`/api/v1/shares/files/${fileId}/${shareId}`, {
      method: 'DELETE',
    });
  },

  // Folder sharing
  async shareFolder(folderId: string, input: CreateShareInput): Promise<ApiResponse<{ share: ShareItem }>> {
    return apiFetch<{ share: ShareItem }>(`/api/v1/shares/folders/${folderId}`, {
      method: 'POST',
      body: JSON.stringify(input),
    });
  },

  async getFolderShares(folderId: string): Promise<ApiResponse<{ shares: ShareItem[] }>> {
    return apiFetch<{ shares: ShareItem[] }>(`/api/v1/shares/folders/${folderId}`, {
      method: 'GET',
    });
  },

  async updateFolderShare(
    folderId: string,
    shareId: string,
    input: UpdateShareInput
  ): Promise<ApiResponse<{ share: ShareItem }>> {
    return apiFetch<{ share: ShareItem }>(`/api/v1/shares/folders/${folderId}/${shareId}`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    });
  },

  async revokeFolderShare(
    folderId: string,
    shareId: string
  ): Promise<ApiResponse<{ message: string; revoked: boolean }>> {
    return apiFetch<{ message: string; revoked: boolean }>(`/api/v1/shares/folders/${folderId}/${shareId}`, {
      method: 'DELETE',
    });
  },

  // Generic share by ID
  async updateShare(
    shareId: string,
    input: UpdateShareInput
  ): Promise<ApiResponse<{ share: ShareItem }>> {
    return apiFetch<{ share: ShareItem }>(`/api/v1/shares/${shareId}`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    });
  },

  async revokeShare(
    shareId: string
  ): Promise<ApiResponse<{ message: string; revoked: boolean }>> {
    return apiFetch<{ message: string; revoked: boolean }>(`/api/v1/shares/${shareId}`, {
      method: 'DELETE',
    });
  },

  // Shared With Me
  async listSharedWithMe(params: {
    page?: number;
    limit?: number;
    resourceType?: ShareResourceType;
  } = {}): Promise<ApiResponse<PaginatedSharedResponse>> {
    const query = new URLSearchParams();
    if (params.page) query.append('page', params.page.toString());
    if (params.limit) query.append('limit', params.limit.toString());
    if (params.resourceType) query.append('resourceType', params.resourceType);

    const queryString = query.toString();
    const endpoint = `/api/v1/shares/with-me${queryString ? `?${queryString}` : ''}`;
    return apiFetch<PaginatedSharedResponse>(endpoint, {
      method: 'GET',
    });
  },

  async getSharedFolderContents(
    folderId: string
  ): Promise<ApiResponse<SharedFolderContentsResponse>> {
    return apiFetch<SharedFolderContentsResponse>(`/api/v1/shares/with-me/folders/${folderId}`, {
      method: 'GET',
    });
  },
};
