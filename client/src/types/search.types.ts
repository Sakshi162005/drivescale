import { EffectivePermission } from './share.types.js';

export type SearchItemType = 'file' | 'folder';

export interface SearchResultItem {
  _id: string;
  type: SearchItemType;
  name: string;
  size?: number;
  mimeType?: string;
  folderId?: string | null;
  locationName: string;
  owner: {
    _id: string;
    name: string;
    email: string;
  };
  isOwner: boolean;
  permission?: EffectivePermission;
  effectivePermission?: EffectivePermission;
  createdAt: string;
  updatedAt: string;
}

export interface SearchPaginationMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  hasNextPage: boolean;
  hasPrevPage: boolean;
}

export interface PaginatedSearchResponse {
  items: SearchResultItem[];
  pagination: SearchPaginationMeta;
}

export interface SearchOptions {
  q: string;
  type?: 'all' | 'file' | 'folder';
  page?: number;
  limit?: number;
  folderId?: string;
  mimeType?: string;
  sortBy?: 'name' | 'size' | 'createdAt' | 'updatedAt';
  sortOrder?: 'asc' | 'desc';
}
