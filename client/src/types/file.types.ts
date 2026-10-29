export interface FileItem {
  _id: string;
  name: string;
  ownerId: string;
  folderId: string | null;
  storageKey: string;
  size: number;
  mimeType: string;
  checksum: string;
  isDeleted: boolean;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  hasNextPage: boolean;
  hasPrevPage: boolean;
}

export interface PaginatedFilesResponse {
  files: FileItem[];
  pagination: PaginationMeta;
}

export interface RenameFileInput {
  name: string;
}

export interface MoveFileInput {
  targetFolderId: string | null;
}
