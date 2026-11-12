import { apiFetch, getAccessToken } from './api.js';
import { ApiResponse } from '../types/auth.types.js';
import {
  VersionListResponse,
  FileVersionItem,
  VersionActionResponse,
} from '../types/version.types.js';

export const versionService = {
  /**
   * List all versions of a file, newest first
   */
  async listVersions(fileId: string): Promise<ApiResponse<VersionListResponse>> {
    return apiFetch<VersionListResponse>(`/api/v1/files/${fileId}/versions`);
  },

  /**
   * Get metadata for a specific file version
   */
  async getVersion(
    fileId: string,
    versionId: string
  ): Promise<ApiResponse<{ version: FileVersionItem }>> {
    return apiFetch<{ version: FileVersionItem }>(
      `/api/v1/files/${fileId}/versions/${versionId}`
    );
  },

  /**
   * Upload a replacement file as a new version
   */
  async uploadReplacementVersion(
    fileId: string,
    file: File
  ): Promise<ApiResponse<VersionActionResponse>> {
    const formData = new FormData();
    formData.append('file', file);

    return apiFetch<VersionActionResponse>(`/api/v1/files/${fileId}/versions`, {
      method: 'POST',
      body: formData,
    });
  },

  /**
   * Restore a historical version by creating a new version from its contents
   */
  async restoreVersion(
    fileId: string,
    versionId: string
  ): Promise<ApiResponse<VersionActionResponse>> {
    return apiFetch<VersionActionResponse>(
      `/api/v1/files/${fileId}/versions/${versionId}/restore`,
      {
        method: 'POST',
      }
    );
  },

  /**
   * Download a specific historical version
   */
  async downloadVersion(
    fileId: string,
    versionId: string,
    fileName: string
  ): Promise<void> {
    const token = getAccessToken();
    const headers = new Headers();
    if (token) {
      headers.set('Authorization', `Bearer ${token}`);
    }

    const response = await fetch(
      `/api/v1/files/${fileId}/versions/${versionId}/download`,
      {
        method: 'GET',
        headers,
        credentials: 'include',
      }
    );

    if (!response.ok) {
      let errorMsg = 'Failed to download version';
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

