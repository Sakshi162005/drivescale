export type TrashItemType = 'file' | 'folder';

export interface TrashItem {
  _id: string;
  type: TrashItemType;
  name: string;
  size: number;
  mimeType?: string;
  deletedAt: string;
  deletedBy?: string | null;
  originalLocationId: string | null;
  originalLocationName: string;
  versionCount?: number;
  ownerId: string;
}

export interface TrashPaginationMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  hasNextPage: boolean;
  hasPrevPage: boolean;
}

export interface PaginatedTrashResponse {
  items: TrashItem[];
  pagination: TrashPaginationMeta;
}

export interface ListTrashOptions {
  type?: 'all' | 'file' | 'folder';
  page?: number;
  limit?: number;
}
