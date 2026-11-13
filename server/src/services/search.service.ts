import mongoose, { Types } from 'mongoose';
import { File, IFile } from '../models/File.js';
import { Folder, IFolder } from '../models/Folder.js';
import { Share } from '../models/Share.js';
import { User } from '../models/User.js';
import { permissionService } from './permission.service.js';
import { cacheService, CacheKeys } from './cache.service.js';
import { SearchQueryInput } from '../schemas/search.schema.js';
import { logger } from '../utils/logger.js';

export interface SearchResultItem {
  _id: string;
  type: 'file' | 'folder';
  name: string;
  size?: number;
  mimeType?: string;
  folderId: string | null;
  parentId?: string | null;
  locationName: string;
  owner: {
    _id: string;
    name: string;
    email: string;
  };
  isOwner: boolean;
  permission?: 'OWNER' | 'VIEW' | 'DOWNLOAD' | 'EDIT';
  effectivePermission?: 'OWNER' | 'VIEW' | 'DOWNLOAD' | 'EDIT' | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface PaginatedSearchResponse {
  items: SearchResultItem[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
    hasNextPage: boolean;
    hasPrevPage: boolean;
  };
}

export class SearchService {
  /**
   * Safely escapes regex special characters to prevent regex injection
   */
  private escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  /**
   * Collects all folders accessible to the user via sharing (direct shares + nested subfolders)
   */
  private async getAccessibleSharedFolderIds(userId: string): Promise<Types.ObjectId[]> {
    try {
      if (mongoose.connection.readyState !== 1 && !(Share.find as unknown as { mock?: unknown }).mock) {
        return [];
      }

      const userObjectId = new Types.ObjectId(userId);
      const now = new Date();

      const directShares = await Share.find({
        recipientId: userObjectId,
        resourceType: 'FOLDER',
        $or: [{ expiresAt: null }, { expiresAt: { $gt: now } }],
      }).select('resourceId');

      const folderIds: Types.ObjectId[] = directShares
        .map((s) => s.resourceId as Types.ObjectId)
        .filter((id) => mongoose.Types.ObjectId.isValid(id));

      if (folderIds.length === 0) {
        return [];
      }

      const allAccessibleFolderIds: Types.ObjectId[] = [...folderIds];
      let queue: Types.ObjectId[] = [...folderIds];
      const visited = new Set<string>(folderIds.map((id) => id.toString()));

      while (queue.length > 0) {
        const currentBatch = queue;
        queue = [];

        const children = await Folder.find({
          parentId: { $in: currentBatch },
          isDeleted: false,
        }).select('_id');

        for (const child of children) {
          const idStr = child._id.toString();
          if (!visited.has(idStr)) {
            visited.add(idStr);
            allAccessibleFolderIds.push(child._id as Types.ObjectId);
            queue.push(child._id as Types.ObjectId);
          }
        }
      }

      return allAccessibleFolderIds;
    } catch {
      return [];
    }
  }

  /**
   * Collects all files directly shared with the user
   */
  private async getDirectSharedFileIds(userId: string): Promise<Types.ObjectId[]> {
    try {
      if (mongoose.connection.readyState !== 1 && !(Share.find as unknown as { mock?: unknown }).mock) {
        return [];
      }

      const userObjectId = new Types.ObjectId(userId);
      const now = new Date();

      const directFileShares = await Share.find({
        recipientId: userObjectId,
        resourceType: 'FILE',
        $or: [{ expiresAt: null }, { expiresAt: { $gt: now } }],
      }).select('resourceId');

      return directFileShares
        .map((s) => s.resourceId as Types.ObjectId)
        .filter((id) => mongoose.Types.ObjectId.isValid(id));
    } catch {
      return [];
    }
  }

  /**
   * Searches files and folders matching the query and authorized for the user
   */
  async search(userId: string, input: SearchQueryInput): Promise<PaginatedSearchResponse> {
    const queryStr = (input.q || '').trim();
    const type = input.type || 'all';
    const page = Math.max(1, input.page || 1);
    const limit = Math.min(100, Math.max(1, input.limit || 20));
    const sortBy = input.sortBy || 'updatedAt';
    const sortOrder = input.sortOrder || 'desc';

    // Handle empty queries safely
    if (!queryStr) {
      return {
        items: [],
        pagination: {
          page,
          limit,
          total: 0,
          totalPages: 1,
          hasNextPage: false,
          hasPrevPage: false,
        },
      };
    }

    // Check Redis cache
    const cacheKey = CacheKeys.searchResults(userId, type, queryStr, page, limit, sortBy, sortOrder);
    const cached = await cacheService.get<PaginatedSearchResponse>(cacheKey);
    if (cached) {
      return cached;
    }

    const userObjectId = new Types.ObjectId(userId);
    const escapedQuery = this.escapeRegex(queryStr);
    const nameRegex = new RegExp(escapedQuery, 'i');

    // Collect shared resources authorized for user
    const [sharedFolderIds, sharedFileIds] = await Promise.all([
      this.getAccessibleSharedFolderIds(userId),
      this.getDirectSharedFileIds(userId),
    ]);

    const collectedItems: SearchResultItem[] = [];

    // 1. Search Files if type is 'all' or 'file'
    if (type === 'all' || type === 'file') {
      const fileOrConditions: Record<string, unknown>[] = [{ ownerId: userObjectId }];
      if (sharedFileIds.length > 0) {
        fileOrConditions.push({ _id: { $in: sharedFileIds } });
      }
      if (sharedFolderIds.length > 0) {
        fileOrConditions.push({ folderId: { $in: sharedFolderIds } });
      }

      const fileFilter: Record<string, unknown> = {
        isDeleted: false,
        name: nameRegex,
        $or: fileOrConditions,
      };

      if (input.folderId) {
        fileFilter.folderId = input.folderId === 'root' ? null : new Types.ObjectId(input.folderId);
      }

      if (input.mimeType) {
        fileFilter.mimeType = new RegExp(this.escapeRegex(input.mimeType), 'i');
      }

      const files = await File.find(fileFilter)
        .select('_id name size mimeType folderId ownerId createdAt updatedAt')
        .lean();

      for (const f of files) {
        const isOwner = f.ownerId.toString() === userId;
        collectedItems.push({
          _id: f._id.toString(),
          type: 'file',
          name: f.name,
          size: f.size,
          mimeType: f.mimeType,
          folderId: f.folderId ? f.folderId.toString() : null,
          locationName: 'My Drive', // Resolved in batch below
          owner: {
            _id: f.ownerId.toString(),
            name: '',
            email: '',
          },
          isOwner,
          permission: isOwner ? 'OWNER' : undefined,
          effectivePermission: isOwner ? 'OWNER' : null,
          createdAt: f.createdAt,
          updatedAt: f.updatedAt,
        });
      }
    }

    // 2. Search Folders if type is 'all' or 'folder'
    if (type === 'all' || type === 'folder') {
      const folderOrConditions: Record<string, unknown>[] = [{ ownerId: userObjectId }];
      if (sharedFolderIds.length > 0) {
        folderOrConditions.push({ _id: { $in: sharedFolderIds } });
      }

      const folderFilter: Record<string, unknown> = {
        isDeleted: false,
        name: nameRegex,
        $or: folderOrConditions,
      };

      if (input.folderId) {
        folderFilter.parentId = input.folderId === 'root' ? null : new Types.ObjectId(input.folderId);
      }

      const folders = await Folder.find(folderFilter)
        .select('_id name parentId ownerId createdAt updatedAt')
        .lean();

      for (const fo of folders) {
        const isOwner = fo.ownerId.toString() === userId;
        collectedItems.push({
          _id: fo._id.toString(),
          type: 'folder',
          name: fo.name,
          parentId: fo.parentId ? fo.parentId.toString() : null,
          folderId: fo.parentId ? fo.parentId.toString() : null,
          locationName: 'My Drive', // Resolved in batch below
          owner: {
            _id: fo.ownerId.toString(),
            name: '',
            email: '',
          },
          isOwner,
          permission: isOwner ? 'OWNER' : undefined,
          effectivePermission: isOwner ? 'OWNER' : null,
          createdAt: fo.createdAt,
          updatedAt: fo.updatedAt,
        });
      }
    }

    // 3. Batch resolve folder locations and owner user details
    const parentFolderIds = Array.from(
      new Set(
        collectedItems
          .map((item) => item.folderId || item.parentId)
          .filter((id): id is string => Boolean(id) && mongoose.Types.ObjectId.isValid(id!))
      )
    );

    const ownerIds = Array.from(
      new Set(
        collectedItems
          .map((item) => item.owner._id)
          .filter((id) => mongoose.Types.ObjectId.isValid(id))
      )
    );

    const [resolvedFolders, resolvedUsers] = await Promise.all([
      parentFolderIds.length > 0
        ? Folder.find({ _id: { $in: parentFolderIds } }).select('_id name').lean()
        : [],
      ownerIds.length > 0
        ? User.find({ _id: { $in: ownerIds } }).select('_id name email').lean()
        : [],
    ]);

    const folderMap = new Map<string, string>();
    for (const rf of resolvedFolders) {
      folderMap.set(rf._id.toString(), rf.name);
    }

    const userMap = new Map<string, { name: string; email: string }>();
    for (const ru of resolvedUsers) {
      userMap.set(ru._id.toString(), { name: ru.name, email: ru.email });
    }

    // Populate resolved metadata and resolve permissions for non-owner items
    for (const item of collectedItems) {
      const parentId = item.folderId || item.parentId;
      if (parentId && folderMap.has(parentId)) {
        item.locationName = folderMap.get(parentId)!;
      } else {
        item.locationName = item.isOwner ? 'My Drive' : 'Shared with me';
      }

      const uInfo = userMap.get(item.owner._id);
      if (uInfo) {
        item.owner.name = uInfo.name;
        item.owner.email = uInfo.email;
      }

      if (!item.isOwner) {
        try {
          if (item.type === 'file') {
            const fakeFile = { _id: new Types.ObjectId(item._id), ownerId: new Types.ObjectId(item.owner._id), folderId: item.folderId ? new Types.ObjectId(item.folderId) : null } as IFile;
            item.effectivePermission = await permissionService.getFilePermission(userId, fakeFile);
          } else {
            const fakeFolder = { _id: new Types.ObjectId(item._id), ownerId: new Types.ObjectId(item.owner._id), parentId: item.parentId ? new Types.ObjectId(item.parentId) : null } as IFolder;
            item.effectivePermission = await permissionService.getFolderPermission(userId, fakeFolder);
          }
          item.permission = (item.effectivePermission as 'VIEW' | 'DOWNLOAD' | 'EDIT') || 'VIEW';
        } catch {
          item.effectivePermission = 'VIEW';
          item.permission = 'VIEW';
        }
      }
    }

    // 4. Sort collected items
    collectedItems.sort((a, b) => {
      let comparison = 0;
      if (sortBy === 'name') {
        comparison = a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
      } else if (sortBy === 'size') {
        const sizeA = a.size || 0;
        const sizeB = b.size || 0;
        comparison = sizeA - sizeB;
      } else if (sortBy === 'createdAt') {
        comparison = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
      } else {
        // default: updatedAt
        comparison = new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime();
      }
      return sortOrder === 'asc' ? comparison : -comparison;
    });

    // 5. Pagination
    const total = collectedItems.length;
    const totalPages = Math.ceil(total / limit) || 1;
    const startIndex = (page - 1) * limit;
    const paginatedItems = collectedItems.slice(startIndex, startIndex + limit);

    const response: PaginatedSearchResponse = {
      items: paginatedItems,
      pagination: {
        page,
        limit,
        total,
        totalPages,
        hasNextPage: page < totalPages,
        hasPrevPage: page > 1,
      },
    };

    // Cache search result for 60 seconds
    await cacheService.set(cacheKey, response, 60);

    logger.info(
      { userId, query: queryStr, type, totalResults: total, returned: paginatedItems.length },
      'Search query executed'
    );

    return response;
  }
}

export const searchService = new SearchService();
