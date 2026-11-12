import { FileItem } from './file.types.js';
import { Folder } from './folder.types.js';

export type ShareResourceType = 'FILE' | 'FOLDER';
export type SharePermission = 'VIEW' | 'DOWNLOAD' | 'EDIT';
export type EffectivePermission = 'OWNER' | 'EDIT' | 'DOWNLOAD' | 'VIEW' | null;

export interface ShareItem {
  _id: string;
  ownerId: string | { _id: string; name: string; email: string };
  recipientId: {
    _id: string;
    name: string;
    email: string;
  };
  resourceType: ShareResourceType;
  resourceId: string;
  permission: SharePermission;
  expiresAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SharedResourceItem {
  shareId: string;
  resourceId: string;
  resourceType: ShareResourceType;
  name: string;
  size?: number;
  mimeType?: string;
  permission: SharePermission;
  effectivePermission: EffectivePermission;
  owner: {
    _id: string;
    name: string;
    email: string;
  };
  createdAt: string;
  updatedAt: string;
}

export interface PaginatedSharedResponse {
  items: SharedResourceItem[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
    hasNextPage: boolean;
    hasPrevPage: boolean;
  };
}

export interface SharedFolderContentsResponse {
  folder: Folder;
  effectivePermission: EffectivePermission;
  subfolders: Folder[];
  files: FileItem[];
}

export interface CreateShareInput {
  recipientEmail?: string;
  recipientId?: string;
  permission: SharePermission;
  expiresAt?: string | null;
}

export interface UpdateShareInput {
  permission: SharePermission;
}
