import mongoose, { Types } from 'mongoose';
import { Share, IShare, ShareResourceType, SharePermission } from '../models/Share.js';
import { File } from '../models/File.js';
import { Folder } from '../models/Folder.js';
import { User, IUser } from '../models/User.js';
import { permissionService, EffectivePermission } from './permission.service.js';
import { cacheService, CacheKeys } from './cache.service.js';
import {
  BadRequestError,
  ForbiddenError,
  NotFoundError,
} from '../utils/errors.js';
import { logger } from '../utils/logger.js';
import { CreateShareInput, UpdateShareInput, ListSharedWithMeQueryInput } from '../schemas/share.schema.js';

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
  createdAt: Date;
  updatedAt: Date;
}

export interface PaginatedSharedResult {
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

export class ShareService {
  /**
   * Validates resource existence and owner authorization
   */
  async validateResourceOwnership(
    ownerId: string,
    resourceType: ShareResourceType,
    resourceId: string
  ): Promise<{ name: string; ownerId: Types.ObjectId }> {
    if (!mongoose.Types.ObjectId.isValid(resourceId)) {
      throw new BadRequestError(`Invalid ${resourceType.toLowerCase()} ID`, 'INVALID_RESOURCE_ID');
    }

    if (resourceType === 'FILE') {
      const file = await File.findById(resourceId);
      if (!file || file.isDeleted) {
        throw new NotFoundError('File not found', 'FILE_NOT_FOUND');
      }
      if (file.ownerId.toString() !== ownerId) {
        throw new ForbiddenError('Only the file owner can manage sharing', 'FORBIDDEN');
      }
      return { name: file.name, ownerId: file.ownerId };
    } else {
      const folder = await Folder.findById(resourceId);
      if (!folder || folder.isDeleted) {
        throw new NotFoundError('Folder not found', 'FOLDER_NOT_FOUND');
      }
      if (folder.ownerId.toString() !== ownerId) {
        throw new ForbiddenError('Only the folder owner can manage sharing', 'FORBIDDEN');
      }
      return { name: folder.name, ownerId: folder.ownerId };
    }
  }

  /**
   * Shares a file or folder with another registered user
   */
  async shareResource(
    ownerId: string,
    resourceType: ShareResourceType,
    resourceId: string,
    input: CreateShareInput
  ): Promise<IShare> {
    await this.validateResourceOwnership(ownerId, resourceType, resourceId);

    // Resolve recipient user
    let recipient: (IUser & { _id: Types.ObjectId }) | null = null;
    if (input.recipientEmail) {
      recipient = await User.findOne({
        email: input.recipientEmail.toLowerCase().trim(),
        isActive: true,
      });
    } else if (input.recipientId) {
      if (!mongoose.Types.ObjectId.isValid(input.recipientId)) {
        throw new BadRequestError('Invalid recipient ID', 'INVALID_RECIPIENT_ID');
      }
      recipient = await User.findOne({
        _id: input.recipientId,
        isActive: true,
      });
    }

    if (!recipient) {
      throw new NotFoundError('Recipient user not found or inactive', 'RECIPIENT_NOT_FOUND');
    }

    // Prevent sharing with oneself
    if (recipient._id.toString() === ownerId) {
      throw new BadRequestError('You cannot share a resource with yourself', 'CANNOT_SHARE_WITH_SELF');
    }

    const expiresAt = input.expiresAt ? new Date(input.expiresAt) : null;

    // Check if share already exists (upsert behavior)
    let share = await Share.findOne({
      resourceType,
      resourceId: new Types.ObjectId(resourceId),
      recipientId: recipient._id,
    });

    if (share) {
      share.permission = input.permission;
      share.expiresAt = expiresAt;
      await share.save();
      logger.info(
        { shareId: share._id, ownerId, recipientId: recipient._id, permission: input.permission },
        'Existing share updated'
      );
    } else {
      share = await Share.create({
        ownerId: new Types.ObjectId(ownerId),
        recipientId: recipient._id,
        resourceType,
        resourceId: new Types.ObjectId(resourceId),
        permission: input.permission,
        expiresAt,
      });
      logger.info(
        { shareId: share._id, ownerId, recipientId: recipient._id, permission: input.permission },
        'New share created'
      );
    }

    // Invalidate caches
    await cacheService.delByPattern(CacheKeys.userAllSharesPattern(recipient._id.toString()));
    await cacheService.delByPattern(CacheKeys.userAllFoldersPattern(recipient._id.toString()));
    await cacheService.delByPattern(CacheKeys.userAllFilesPattern(recipient._id.toString()));

    // Populate recipient info before returning
    await share.populate('recipientId', '_id name email');
    return share;
  }

  /**
   * Retrieves all active shares for a specific resource (owner only)
   */
  async getSharesForResource(
    ownerId: string,
    resourceType: ShareResourceType,
    resourceId: string
  ): Promise<IShare[]> {
    await this.validateResourceOwnership(ownerId, resourceType, resourceId);

    const shares = await Share.find({
      ownerId: new Types.ObjectId(ownerId),
      resourceType,
      resourceId: new Types.ObjectId(resourceId),
    })
      .populate('recipientId', '_id name email')
      .sort({ createdAt: -1 });

    return shares;
  }

  /**
   * Updates an existing share's permission level (owner only)
   */
  async updateShare(ownerId: string, shareId: string, input: UpdateShareInput): Promise<IShare> {
    if (!mongoose.Types.ObjectId.isValid(shareId)) {
      throw new BadRequestError('Invalid share ID', 'INVALID_SHARE_ID');
    }

    const share = await Share.findById(shareId);
    if (!share) {
      throw new NotFoundError('Share not found', 'SHARE_NOT_FOUND');
    }

    if (share.ownerId.toString() !== ownerId) {
      throw new ForbiddenError('Only the resource owner can modify this share', 'FORBIDDEN');
    }

    share.permission = input.permission;
    await share.save();

    logger.info({ shareId, ownerId, newPermission: input.permission }, 'Share permission updated');

    // Invalidate caches
    await cacheService.delByPattern(CacheKeys.userAllSharesPattern(share.recipientId.toString()));
    await cacheService.delByPattern(CacheKeys.userAllFoldersPattern(share.recipientId.toString()));
    await cacheService.delByPattern(CacheKeys.userAllFilesPattern(share.recipientId.toString()));

    await share.populate('recipientId', '_id name email');
    return share;
  }

  /**
   * Revokes an existing share immediately (owner only)
   */
  async revokeShare(ownerId: string, shareId: string): Promise<void> {
    if (!mongoose.Types.ObjectId.isValid(shareId)) {
      throw new BadRequestError('Invalid share ID', 'INVALID_SHARE_ID');
    }

    const share = await Share.findById(shareId);
    if (!share) {
      throw new NotFoundError('Share not found', 'SHARE_NOT_FOUND');
    }

    if (share.ownerId.toString() !== ownerId) {
      throw new ForbiddenError('Only the resource owner can revoke this share', 'FORBIDDEN');
    }

    const recipientId = share.recipientId.toString();
    await Share.findByIdAndDelete(shareId);

    logger.info({ shareId, ownerId, recipientId }, 'Share revoked successfully');

    // Invalidate caches immediately
    await cacheService.delByPattern(CacheKeys.userAllSharesPattern(recipientId));
    await cacheService.delByPattern(CacheKeys.userAllFoldersPattern(recipientId));
    await cacheService.delByPattern(CacheKeys.userAllFilesPattern(recipientId));
  }

  /**
   * Lists resources shared with the authenticated user
   */
  async listSharedWithMe(userId: string, query: ListSharedWithMeQueryInput): Promise<PaginatedSharedResult> {
    const page = Math.max(1, query.page || 1);
    const limit = Math.min(100, Math.max(1, query.limit || 20));
    const skip = (page - 1) * limit;

    const filter: Record<string, unknown> = {
      recipientId: new Types.ObjectId(userId),
      $or: [{ expiresAt: null }, { expiresAt: { $gt: new Date() } }],
    };

    if (query.resourceType) {
      filter.resourceType = query.resourceType;
    }

    const shares = await Share.find(filter)
      .populate('ownerId', '_id name email')
      .sort({ createdAt: -1 });

    const items: SharedResourceItem[] = [];

    for (const share of shares) {
      const ownerInfo = share.ownerId as unknown as { _id: Types.ObjectId; name: string; email: string };
      if (share.resourceType === 'FILE') {
        const file = await File.findById(share.resourceId);
        if (file && !file.isDeleted) {
          const effectivePermission = await permissionService.getFilePermission(userId, file);
          items.push({
            shareId: share._id.toString(),
            resourceId: file._id.toString(),
            resourceType: 'FILE',
            name: file.name,
            size: file.size,
            mimeType: file.mimeType,
            permission: share.permission,
            effectivePermission,
            owner: {
              _id: ownerInfo._id.toString(),
              name: ownerInfo.name,
              email: ownerInfo.email,
            },
            createdAt: share.createdAt,
            updatedAt: share.updatedAt,
          });
        }
      } else {
        const folder = await Folder.findById(share.resourceId);
        if (folder && !folder.isDeleted) {
          const effectivePermission = await permissionService.getFolderPermission(userId, folder);
          items.push({
            shareId: share._id.toString(),
            resourceId: folder._id.toString(),
            resourceType: 'FOLDER',
            name: folder.name,
            permission: share.permission,
            effectivePermission,
            owner: {
              _id: ownerInfo._id.toString(),
              name: ownerInfo.name,
              email: ownerInfo.email,
            },
            createdAt: share.createdAt,
            updatedAt: share.updatedAt,
          });
        }
      }
    }

    const total = items.length;
    const paginatedItems = items.slice(skip, skip + limit);
    const totalPages = Math.ceil(total / limit) || 1;

    return {
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
  }

  /**
   * Retrieves children of a shared folder respecting inherited permissions
   */
  async getSharedFolderChildren(userId: string, folderId: string) {
    if (!mongoose.Types.ObjectId.isValid(folderId)) {
      throw new BadRequestError('Invalid folder ID', 'INVALID_FOLDER_ID');
    }

    const folder = await Folder.findById(folderId);
    if (!folder || folder.isDeleted) {
      throw new NotFoundError('Folder not found', 'FOLDER_NOT_FOUND');
    }

    const permission = await permissionService.getFolderPermission(userId, folder);
    if (!permissionService.canView(permission)) {
      throw new ForbiddenError('You do not have permission to view this shared folder', 'FORBIDDEN');
    }

    // List child folders
    const subfolders = await Folder.find({
      parentId: folder._id,
      isDeleted: false,
    }).sort({ name: 1 });

    // List child files
    const files = await File.find({
      folderId: folder._id,
      isDeleted: false,
    }).sort({ name: 1 });

    return {
      folder,
      effectivePermission: permission,
      subfolders,
      files,
    };
  }
}

export const shareService = new ShareService();

