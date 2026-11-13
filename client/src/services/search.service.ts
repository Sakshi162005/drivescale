import { apiFetch } from './api.js';
import { ApiResponse } from '../types/auth.types.js';
import { PaginatedSearchResponse, SearchOptions } from '../types/search.types.js';

export const searchService = {
  /**
   * Search files and folders
   */
  async search(options: SearchOptions): Promise<ApiResponse<PaginatedSearchResponse>> {
    const params = new URLSearchParams();
    params.set('q', options.q);

    if (options.type && options.type !== 'all') {
      params.set('type', options.type);
    }
    if (options.page) {
      params.set('page', options.page.toString());
    }
    if (options.limit) {
      params.set('limit', options.limit.toString());
    }
    if (options.folderId) {
      params.set('folderId', options.folderId);
    }
    if (options.mimeType) {
      params.set('mimeType', options.mimeType);
    }
    if (options.sortBy) {
      params.set('sortBy', options.sortBy);
    }
    if (options.sortOrder) {
      params.set('sortOrder', options.sortOrder);
    }

    return apiFetch<PaginatedSearchResponse>(`/api/v1/search?${params.toString()}`);
  },
};
