import mongoose, { Types } from 'mongoose';
import { File, IFile } from '../models/File.js';
import { Folder, IFolder } from '../models/Folder.js';
import { FileVersion } from '../models/FileVersion.js';
import { Share } from '../models/Share.js';
import { User } from '../models/User.js';
import { storageService } from './storage/index.js';
import { cacheService, CacheKeys } from './cache.service.js';
import { logger } from '../utils/logger.js';
import {
  BadRequestError,
  NotFoundError,
  ForbiddenError,
} from '../utils/errors.js';
import { ListTrashQuery, RestoreTrashItemInput } from '../schemas/trash.schema.js';

export interface TrashItem {
  _id: string;
  type: 'file' | 'folder';
  name: string;
  size: number;
  mimeType?: string;
  deletedAt: Date;
  deletedBy?: string | null;
  originalLocationId: string | null;
  originalLocationName: string;
  versionCount?: number;
  ownerId: string;
}

export interface PaginatedTrashResponse {
  items: TrashItem[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
    hasNextPage: boolean;
    hasPrevPage: boolean;
  };
}

export class TrashService {
  /**
   * Helper to generate a unique filename upon restore collision
   */
  private async getAvailableFileName(
    ownerId: Types.ObjectId,
    folderId: Types.ObjectId | null,
    originalName: string
  ): Promise<string> {
    let name = originalName;
    let counter = 1;
    const extIndex = originalName.lastIndexOf('.');
    const baseName = extIndex !== -1 ? originalName.slice(0, extIndex) : originalName;
    const extension = extIndex !== -1 ? originalName.slice(extIndex) : '';

    while (await File.findOne({ ownerId, folderId, name, isDeleted: false })) {
      name = `${baseName} (restored${counter > 1 ? ` ${counter}` : ''})${extension}`;
      counter++;
    }
    return name;
  }

  /**
   * Helper to generate a unique folder name upon restore collision
   */
  private async getAvailableFolderName(
    ownerId: Types.ObjectId,
    parentId: Types.ObjectId | null,
    originalName: string
  ): Promise<string> {
    let name = originalName;
    let counter = 1;
    while (await Folder.findOne({ ownerId, parentId, name, isDeleted: false })) {
      name = `${originalName} (restored${counter > 1 ? ` ${counter}` : ''})`;
      counter++;
    }
    return name;
  }

  /**
   * Lists the requesting user's deleted items (files and folders).
   * Only top-level deleted items (deletedWithFolderId: null) are returned.
   */
  async listTrash(userId: string, query: ListTrashQuery): Promise<PaginatedTrashResponse> {
    if (!mongoose.Types.ObjectId.isValid(userId)) {
      throw new BadRequestError('Invalid user ID', 'INVALID_USER_ID');
    }

    const { page, limit, type, sortBy, sortOrder } = query;
    const cacheKey = CacheKeys.trashList(userId, type, page, limit);

    // Check cache
    const cached = await cacheService.get<PaginatedTrashResponse>(cacheKey);
    if (cached) {
      return cached;
    }

    const ownerObjectId = new Types.ObjectId(userId);
    const filter = {
      ownerId: ownerObjectId,
      isDeleted: true,
      deletedWithFolderId: null,
    };

    let items: TrashItem[] = [];

    // Query files if type is 'all' or 'file'
    if (type === 'all' || type === 'file') {
      const trashedFiles = await File.find(filter)
        .select('_id name size mimeType deletedAt deletedBy originalFolderId folderId versionCount ownerId')
        .lean();

      for (const f of trashedFiles) {
        items.push({
          _id: f._id.toString(),
          type: 'file',
          name: f.name,
          size: f.size,
          mimeType: f.mimeType,
          deletedAt: f.deletedAt || new Date(),
          deletedBy: f.deletedBy ? f.deletedBy.toString() : null,
          originalLocationId: (f.originalFolderId || f.folderId)?.toString() || null,
          originalLocationName: 'Root', // Populated below in bulk
          versionCount: f.versionCount || 1,
          ownerId: f.ownerId.toString(),
        });
      }
    }

    // Query folders if type is 'all' or 'folder'
    if (type === 'all' || type === 'folder') {
      const trashedFolders = await Folder.find(filter)
        .select('_id name deletedAt deletedBy originalParentId parentId ownerId')
        .lean();

      for (const fo of trashedFolders) {
        items.push({
          _id: fo._id.toString(),
          type: 'folder',
          name: fo.name,
          size: 0,
          deletedAt: fo.deletedAt || new Date(),
          deletedBy: fo.deletedBy ? fo.deletedBy.toString() : null,
          originalLocationId: (fo.originalParentId || fo.parentId)?.toString() || null,
          originalLocationName: 'Root', // Populated below in bulk
          ownerId: fo.ownerId.toString(),
        });
      }
    }

    // Resolve original location names for display
    const locationIdsToFetch = Array.from(
      new Set(
        items
          .map((item) => item.originalLocationId)
          .filter((id): id is string => id !== null && mongoose.Types.ObjectId.isValid(id))
      )
    );

    if (locationIdsToFetch.length > 0) {
      const locationFolders = await Folder.find({
        _id: { $in: locationIdsToFetch.map((id) => new Types.ObjectId(id)) },
      })
        .select('_id name isDeleted')
        .lean();

      const locationMap = new Map<string, string>();
      for (const lf of locationFolders) {
        locationMap.set(lf._id.toString(), lf.isDeleted ? `${lf.name} (in Trash)` : lf.name);
      }

      for (const item of items) {
        if (item.originalLocationId) {
          item.originalLocationName = locationMap.get(item.originalLocationId) || 'Unknown Location';
        }
      }
    }

    // Sort items
    items.sort((a, b) => {
      let comparison = 0;
      if (sortBy === 'name') {
        comparison = a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
      } else if (sortBy === 'size') {
        comparison = a.size - b.size;
      } else {
        // default: deletedAt
        comparison = new Date(a.deletedAt).getTime() - new Date(b.deletedAt).getTime();
      }
      return sortOrder === 'asc' ? comparison : -comparison;
    });

    const total = items.length;
    const totalPages = Math.ceil(total / limit) || 1;
    const startIndex = (page - 1) * limit;
    const paginatedItems = items.slice(startIndex, startIndex + limit);

    const result: PaginatedTrashResponse = {
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

    // Cache trash listing for 60 seconds
    await cacheService.set(cacheKey, result, 60);

    return result;
  }

  /**
   * Restores a deleted file to its original location (or root fallback).
   */
  async restoreFile(
    userId: string,
    fileId: string,
    options?: RestoreTrashItemInput
  ): Promise<{ file: IFile; restoredLocationName: string }> {
    if (!mongoose.Types.ObjectId.isValid(fileId)) {
      throw new BadRequestError('Invalid file ID', 'INVALID_FILE_ID');
    }

    const file = await File.findById(fileId);
    if (!file || !file.isDeleted) {
      throw new NotFoundError('File not found in trash', 'FILE_NOT_IN_TRASH');
    }

    if (file.ownerId.toString() !== userId) {
      throw new ForbiddenError('You can only restore your own files', 'FORBIDDEN');
    }

    // Target folder determination
    let targetFolderId: Types.ObjectId | null = null;
    if (options?.targetFolderId !== undefined) {
      targetFolderId = options.targetFolderId ? new Types.ObjectId(options.targetFolderId) : null;
    } else if (file.originalFolderId) {
      targetFolderId = file.originalFolderId;
    } else if (file.folderId) {
      targetFolderId = file.folderId;
    }

    // If destination folder is deleted or nonexistent, safely fall back to root (null)
    let restoredLocationName = 'Root';
    if (targetFolderId) {
      const destinationFolder = await Folder.findOne({
        _id: targetFolderId,
        ownerId: file.ownerId,
        isDeleted: false,
      });

      if (!destinationFolder) {
        targetFolderId = null;
        restoredLocationName = 'Root (fallback from deleted parent)';
      } else {
        restoredLocationName = destinationFolder.name;
      }
    }

    // Resolve name collisions in the target destination
    const finalName = await this.getAvailableFileName(file.ownerId, targetFolderId, file.name);

    // Validate storage quota before restoring
    const user = await User.findById(userId);
    if (!user) {
      throw new NotFoundError('User not found', 'USER_NOT_FOUND');
    }
    const currentUsed = user.storageUsed || 0;
    const currentReserved = user.storageReserved || 0;
    if (currentUsed + currentReserved + file.size > user.storageQuota) {
      throw new BadRequestError(
        'Storage quota exceeded. Please free up space before restoring this file.',
        'STORAGE_QUOTA_EXCEEDED'
      );
    }

    // Update file document
    file.isDeleted = false;
    file.deletedAt = null;
    file.deletedBy = null;
    file.deletedWithFolderId = null;
    file.folderId = targetFolderId;
    file.name = finalName;
    await file.save();

    // Increment user active storage usage
    await User.findByIdAndUpdate(userId, {
      $inc: { storageUsed: file.size },
    });

    logger.info(
      { fileId: file._id, finalName, folderId: targetFolderId, size: file.size },
      'File restored from trash successfully'
    );

    // Invalidate caches
    await cacheService.del(CacheKeys.fileDetail(userId, fileId));
    await cacheService.delByPattern(CacheKeys.userAllFilesPattern(userId));
    await cacheService.delByPattern(CacheKeys.userAllTrashPattern(userId));
    await cacheService.delByPattern(CacheKeys.userAllSearchPattern(userId));
    await cacheService.del(CacheKeys.userStorageStats(userId));

    return { file, restoredLocationName };
  }

  /**
   * Restores a deleted folder and all contents that were deleted with it.
   */
  async restoreFolder(
    userId: string,
    folderId: string,
    options?: RestoreTrashItemInput
  ): Promise<{ folder: IFolder; restoredFilesCount: number; restoredFoldersCount: number }> {
    if (!mongoose.Types.ObjectId.isValid(folderId)) {
      throw new BadRequestError('Invalid folder ID', 'INVALID_FOLDER_ID');
    }

    const folder = await Folder.findById(folderId);
    if (!folder || !folder.isDeleted) {
      throw new NotFoundError('Folder not found in trash', 'FOLDER_NOT_IN_TRASH');
    }

    if (folder.ownerId.toString() !== userId) {
      throw new ForbiddenError('You can only restore your own folders', 'FORBIDDEN');
    }

    // Target parent folder determination
    let targetParentId: Types.ObjectId | null = null;
    if (options?.targetParentId !== undefined) {
      targetParentId = options.targetParentId ? new Types.ObjectId(options.targetParentId) : null;
    } else if (folder.originalParentId) {
      targetParentId = folder.originalParentId;
    } else if (folder.parentId) {
      targetParentId = folder.parentId;
    }

    // If destination parent is deleted or nonexistent, safely fall back to root (null)
    if (targetParentId) {
      const destinationParent = await Folder.findOne({
        _id: targetParentId,
        ownerId: folder.ownerId,
        isDeleted: false,
      });

      if (!destinationParent) {
        targetParentId = null;
      }
    }

    // Resolve name collision in target parent folder
    const finalName = await this.getAvailableFolderName(folder.ownerId, targetParentId, folder.name);

    // 0. Pre-calculate total size of descendant files to validate storage quota
    const descendantFiles = await File.find({
      ownerId: folder.ownerId,
      deletedWithFolderId: folder._id,
    });
    const totalRestoredSize = descendantFiles.reduce((acc, f) => acc + f.size, 0);

    const user = await User.findById(userId);
    if (!user) {
      throw new NotFoundError('User not found', 'USER_NOT_FOUND');
    }
    const currentUsed = user.storageUsed || 0;
    const currentReserved = user.storageReserved || 0;
    if (currentUsed + currentReserved + totalRestoredSize > user.storageQuota) {
      throw new BadRequestError(
        'Storage quota exceeded. Please free up space before restoring this folder.',
        'STORAGE_QUOTA_EXCEEDED'
      );
    }

    // 1. Restore the root folder
    folder.isDeleted = false;
    folder.deletedAt = null;
    folder.deletedBy = null;
    folder.deletedWithFolderId = null;
    folder.parentId = targetParentId;
    folder.name = finalName;
    await folder.save();

    // 2. Restore all descendant folders that were deleted with this folder
    const descendantFoldersResult = await Folder.updateMany(
      { ownerId: folder.ownerId, deletedWithFolderId: folder._id },
      {
        $set: {
          isDeleted: false,
          deletedAt: null,
          deletedBy: null,
          deletedWithFolderId: null,
        },
      }
    );

    // 3. Restore all descendant files that were deleted with this folder
    await File.updateMany(
      { ownerId: folder.ownerId, deletedWithFolderId: folder._id },
      {
        $set: {
          isDeleted: false,
          deletedAt: null,
          deletedBy: null,
          deletedWithFolderId: null,
        },
      }
    );

    // Increment active storage usage for all restored files
    if (totalRestoredSize > 0) {
      await User.findByIdAndUpdate(userId, {
        $inc: { storageUsed: totalRestoredSize },
      });
    }

    logger.info(
      {
        folderId: folder._id,
        restoredFoldersCount: (descendantFoldersResult.modifiedCount || 0) + 1,
        restoredFilesCount: descendantFiles.length,
        totalSize: totalRestoredSize,
      },
      'Folder and descendants restored from trash successfully'
    );

    // Invalidate caches
    await cacheService.delByPattern(CacheKeys.userAllFoldersPattern(userId));
    await cacheService.delByPattern(CacheKeys.userAllFilesPattern(userId));
    await cacheService.delByPattern(CacheKeys.userAllTrashPattern(userId));
    await cacheService.delByPattern(CacheKeys.userAllSearchPattern(userId));
    await cacheService.delByPattern(CacheKeys.userAllSearchPattern(userId));
    await cacheService.del(CacheKeys.userStorageStats(userId));

    return {
      folder,
      restoredFilesCount: descendantFiles.length,
      restoredFoldersCount: (descendantFoldersResult.modifiedCount || 0) + 1,
    };
  }

  /**
   * Generic restore method that dynamically routes to restoreFile or restoreFolder
   */
  async restoreItem(
    userId: string,
    itemId: string,
    options?: RestoreTrashItemInput
  ): Promise<{ type: 'file' | 'folder'; item: IFile | IFolder }> {
    if (!mongoose.Types.ObjectId.isValid(itemId)) {
      throw new BadRequestError('Invalid item ID', 'INVALID_ITEM_ID');
    }

    // Try finding in File first
    const file = await File.findOne({ _id: itemId, isDeleted: true });
    if (file) {
      const res = await this.restoreFile(userId, itemId, options);
      return { type: 'file', item: res.file };
    }

    // Try finding in Folder
    const folder = await Folder.findOne({ _id: itemId, isDeleted: true });
    if (folder) {
      const res = await this.restoreFolder(userId, itemId, options);
      return { type: 'folder', item: res.folder };
    }

    throw new NotFoundError('Item not found in trash', 'TRASH_ITEM_NOT_FOUND');
  }

  /**
   * Permanently deletes a trashed file, removing all versions, storage objects, shares, and DB records.
   */
  async permanentlyDeleteFile(userId: string, fileId: string): Promise<void> {
    if (!mongoose.Types.ObjectId.isValid(fileId)) {
      throw new BadRequestError('Invalid file ID', 'INVALID_FILE_ID');
    }

    const file = await File.findById(fileId);
    if (!file || !file.isDeleted) {
      throw new NotFoundError('File not found in trash', 'FILE_NOT_IN_TRASH');
    }

    if (file.ownerId.toString() !== userId) {
      throw new ForbiddenError('You can only permanently delete your own files', 'FORBIDDEN');
    }

    // 1. Gather all storage keys (main file + all historical file versions)
    const versions = await FileVersion.find({ fileId: file._id });
    const storageKeysToDelete = new Set<string>();

    if (file.storageKey) {
      storageKeysToDelete.add(file.storageKey);
    }
    for (const v of versions) {
      if (v.storageKey) {
        storageKeysToDelete.add(v.storageKey);
      }
    }

    // 2. Remove physical storage objects safely
    for (const key of storageKeysToDelete) {
      try {
        await storageService.delete(key);
      } catch (storageErr) {
        logger.warn(
          { key, fileId, err: storageErr instanceof Error ? storageErr.message : 'Unknown' },
          'Storage key deletion encountered error during permanent file deletion (non-fatal)'
        );
      }
    }

    // 3. Delete database records
    await FileVersion.deleteMany({ fileId: file._id });
    await Share.deleteMany({ resourceType: 'FILE', resourceId: file._id });
    await File.findByIdAndDelete(file._id);

    logger.info(
      { fileId, versionsDeleted: versions.length, keysDeleted: storageKeysToDelete.size },
      'File and versions permanently deleted successfully'
    );

    // Invalidate caches
    await cacheService.del(CacheKeys.fileDetail(userId, fileId));
    await cacheService.delByPattern(CacheKeys.fileAllVersionsPattern(fileId));
    await cacheService.delByPattern(CacheKeys.userAllFilesPattern(userId));
    await cacheService.delByPattern(CacheKeys.userAllTrashPattern(userId));
    await cacheService.delByPattern(CacheKeys.userAllSearchPattern(userId));
  }

  /**
   * Permanently deletes a trashed folder and all its trashed descendant files and subfolders.
   */
  async permanentlyDeleteFolder(userId: string, folderId: string): Promise<void> {
    if (!mongoose.Types.ObjectId.isValid(folderId)) {
      throw new BadRequestError('Invalid folder ID', 'INVALID_FOLDER_ID');
    }

    const folder = await Folder.findById(folderId);
    if (!folder || !folder.isDeleted) {
      throw new NotFoundError('Folder not found in trash', 'FOLDER_NOT_IN_TRASH');
    }

    if (folder.ownerId.toString() !== userId) {
      throw new ForbiddenError('You can only permanently delete your own folders', 'FORBIDDEN');
    }

    // 1. Gather all descendant folders deleted with this folder
    const descendantFolders = await Folder.find({
      ownerId: folder.ownerId,
      deletedWithFolderId: folder._id,
    });
    const allFolderIds = [folder._id, ...descendantFolders.map((f) => f._id)];

    // 2. Gather all files in this hierarchy deleted with this folder
    const filesToDelete = await File.find({
      ownerId: folder.ownerId,
      $or: [{ folderId: { $in: allFolderIds } }, { deletedWithFolderId: folder._id }],
    });

    const fileIds = filesToDelete.map((f) => f._id);

    // 3. For each file, delete versions & storage objects
    for (const file of filesToDelete) {
      const versions = await FileVersion.find({ fileId: file._id });
      const storageKeys = new Set<string>();
      if (file.storageKey) storageKeys.add(file.storageKey);
      for (const v of versions) {
        if (v.storageKey) storageKeys.add(v.storageKey);
      }

      for (const key of storageKeys) {
        try {
          await storageService.delete(key);
        } catch (err) {
          logger.warn({ key, fileId: file._id, err }, 'Failed to delete file storage key (non-fatal)');
        }
      }
    }

    // 4. Delete versions, shares, files, and folders
    if (fileIds.length > 0) {
      await FileVersion.deleteMany({ fileId: { $in: fileIds } });
      await Share.deleteMany({ resourceType: 'FILE', resourceId: { $in: fileIds } });
      await File.deleteMany({ _id: { $in: fileIds } });
    }

    await Share.deleteMany({ resourceType: 'FOLDER', resourceId: { $in: allFolderIds } });
    await Folder.deleteMany({ _id: { $in: allFolderIds } });

    logger.info(
      {
        folderId,
        foldersDeleted: allFolderIds.length,
        filesDeleted: filesToDelete.length,
      },
      'Folder and descendants permanently deleted successfully'
    );

    // Invalidate caches
    await cacheService.delByPattern(CacheKeys.userAllFoldersPattern(userId));
    await cacheService.delByPattern(CacheKeys.userAllFilesPattern(userId));
    await cacheService.delByPattern(CacheKeys.userAllTrashPattern(userId));
    await cacheService.delByPattern(CacheKeys.userAllSearchPattern(userId));
  }

  /**
   * Generic permanent deletion routing to either permanentlyDeleteFile or permanentlyDeleteFolder
   */
  async permanentlyDeleteItem(userId: string, itemId: string): Promise<{ type: 'file' | 'folder' }> {
    if (!mongoose.Types.ObjectId.isValid(itemId)) {
      throw new BadRequestError('Invalid item ID', 'INVALID_ITEM_ID');
    }

    const file = await File.findOne({ _id: itemId, isDeleted: true });
    if (file) {
      await this.permanentlyDeleteFile(userId, itemId);
      return { type: 'file' };
    }

    const folder = await Folder.findOne({ _id: itemId, isDeleted: true });
    if (folder) {
      await this.permanentlyDeleteFolder(userId, itemId);
      return { type: 'folder' };
    }

    throw new NotFoundError('Item not found in trash', 'TRASH_ITEM_NOT_FOUND');
  }

  /**
   * Permanently clears all items in trash for a user
   */
  async emptyTrash(userId: string): Promise<{ filesDeleted: number; foldersDeleted: number }> {
    if (!mongoose.Types.ObjectId.isValid(userId)) {
      throw new BadRequestError('Invalid user ID', 'INVALID_USER_ID');
    }

    const ownerObjectId = new Types.ObjectId(userId);

    // Get top-level trashed files
    const topFiles = await File.find({
      ownerId: ownerObjectId,
      isDeleted: true,
      deletedWithFolderId: null,
    }).select('_id');

    // Get top-level trashed folders
    const topFolders = await Folder.find({
      ownerId: ownerObjectId,
      isDeleted: true,
      deletedWithFolderId: null,
    }).select('_id');

    for (const f of topFiles) {
      try {
        await this.permanentlyDeleteFile(userId, f._id.toString());
      } catch (err) {
        logger.warn({ fileId: f._id, err }, 'Failed to permanently delete file during emptyTrash');
      }
    }

    for (const fo of topFolders) {
      try {
        await this.permanentlyDeleteFolder(userId, fo._id.toString());
      } catch (err) {
        logger.warn({ folderId: fo._id, err }, 'Failed to permanently delete folder during emptyTrash');
      }
    }

    return {
      filesDeleted: topFiles.length,
      foldersDeleted: topFolders.length,
    };
  }

  /**
   * Background worker job: finds items in trash older than retention threshold and purges them.
   */
  async cleanupExpiredTrash(
    olderThanDays: number,
    batchSize: number
  ): Promise<{ cleanedFilesCount: number; cleanedFoldersCount: number }> {
    const cutoffDate = new Date(Date.now() - olderThanDays * 24 * 60 * 60 * 1000);
    logger.info({ olderThanDays, batchSize, cutoffDate }, 'Starting expired trash cleanup execution');

    let cleanedFilesCount = 0;
    let cleanedFoldersCount = 0;

    // 1. Find eligible top-level files
    const eligibleFiles = await File.find({
      isDeleted: true,
      deletedWithFolderId: null,
      deletedAt: { $lt: cutoffDate },
    })
      .limit(batchSize)
      .select('_id ownerId');

    for (const f of eligibleFiles) {
      try {
        await this.permanentlyDeleteFile(f.ownerId.toString(), f._id.toString());
        cleanedFilesCount++;
      } catch (err) {
        logger.warn(
          { fileId: f._id, err: err instanceof Error ? err.message : 'Unknown' },
          'Failed to cleanup expired file'
        );
      }
    }

    // 2. Find eligible top-level folders
    const remainingBatch = Math.max(0, batchSize - cleanedFilesCount);
    if (remainingBatch > 0) {
      const eligibleFolders = await Folder.find({
        isDeleted: true,
        deletedWithFolderId: null,
        deletedAt: { $lt: cutoffDate },
      })
        .limit(remainingBatch)
        .select('_id ownerId');

      for (const fo of eligibleFolders) {
        try {
          await this.permanentlyDeleteFolder(fo.ownerId.toString(), fo._id.toString());
          cleanedFoldersCount++;
        } catch (err) {
          logger.warn(
            { folderId: fo._id, err: err instanceof Error ? err.message : 'Unknown' },
            'Failed to cleanup expired folder'
          );
        }
      }
    }

    logger.info(
      { cleanedFilesCount, cleanedFoldersCount, cutoffDate },
      'Expired trash cleanup execution finished'
    );

    return {
      cleanedFilesCount,
      cleanedFoldersCount,
    };
  }
}

export const trashService = new TrashService();

