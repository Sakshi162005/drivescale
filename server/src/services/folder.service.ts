import mongoose, { Types } from 'mongoose';
import { Folder, IFolder } from '../models/Folder.js';
import { CreateFolderInput } from '../schemas/folder.schema.js';
import {
  BadRequestError,
  ConflictError,
  NotFoundError,
  UnauthorizedError,
} from '../utils/errors.js';
import { logger } from '../utils/logger.js';

export interface BreadcrumbItem {
  _id: string;
  name: string;
  parentId: string | null;
}

export class FolderService {
  /**
   * Creates a new folder under root or a specified parent
   */
  async createFolder(ownerId: string, input: CreateFolderInput): Promise<IFolder> {
    let normalizedParentId: Types.ObjectId | null = null;

    if (input.parentId && input.parentId !== 'root') {
      if (!mongoose.Types.ObjectId.isValid(input.parentId)) {
        throw new BadRequestError('Invalid parent folder ID', 'INVALID_PARENT_ID');
      }

      const parentFolder = await Folder.findById(input.parentId);
      if (!parentFolder || parentFolder.isDeleted) {
        throw new NotFoundError('Parent folder not found', 'PARENT_NOT_FOUND');
      }

      if (parentFolder.ownerId.toString() !== ownerId) {
        throw new UnauthorizedError('You do not have permission to create folders in this directory', 'FORBIDDEN');
      }

      normalizedParentId = parentFolder._id as Types.ObjectId;
    }

    // Check for duplicate folder name under the same parent
    const existing = await Folder.findOne({
      ownerId,
      parentId: normalizedParentId,
      name: input.name,
      isDeleted: false,
    });

    if (existing) {
      throw new ConflictError(
        `A folder named '${input.name}' already exists in this location`,
        'FOLDER_ALREADY_EXISTS'
      );
    }

    const folder = await Folder.create({
      name: input.name,
      ownerId: new Types.ObjectId(ownerId),
      parentId: normalizedParentId,
    });

    logger.info({ folderId: folder._id, ownerId }, 'Folder created successfully');

    return folder;
  }

  /**
   * Retrieves a folder and its breadcrumb hierarchy
   */
  async getFolder(ownerId: string, folderId: string): Promise<{ folder: IFolder | { _id: string; name: string; parentId: null; isRoot: boolean }; breadcrumbs: BreadcrumbItem[] }> {
    if (folderId === 'root') {
      return {
        folder: {
          _id: 'root',
          name: 'My Drive',
          parentId: null,
          isRoot: true,
        },
        breadcrumbs: [],
      };
    }

    if (!mongoose.Types.ObjectId.isValid(folderId)) {
      throw new BadRequestError('Invalid folder ID', 'INVALID_FOLDER_ID');
    }

    const folder = await Folder.findById(folderId);
    if (!folder || folder.isDeleted) {
      throw new NotFoundError('Folder not found', 'FOLDER_NOT_FOUND');
    }

    if (folder.ownerId.toString() !== ownerId) {
      throw new UnauthorizedError('You do not have permission to access this folder', 'FORBIDDEN');
    }

    const breadcrumbs = await this.getBreadcrumbs(ownerId, folder);

    return { folder, breadcrumbs };
  }

  /**
   * Lists child folders for a given parent (or root)
   */
  async getFolderChildren(ownerId: string, folderId: string): Promise<IFolder[]> {
    let normalizedParentId: Types.ObjectId | null = null;

    if (folderId !== 'root') {
      if (!mongoose.Types.ObjectId.isValid(folderId)) {
        throw new BadRequestError('Invalid folder ID', 'INVALID_FOLDER_ID');
      }

      const parent = await Folder.findById(folderId);
      if (!parent || parent.isDeleted) {
        throw new NotFoundError('Folder not found', 'FOLDER_NOT_FOUND');
      }

      if (parent.ownerId.toString() !== ownerId) {
        throw new UnauthorizedError('You do not have permission to access this folder', 'FORBIDDEN');
      }

      normalizedParentId = parent._id as Types.ObjectId;
    }

    const children = await Folder.find({
      ownerId: new Types.ObjectId(ownerId),
      parentId: normalizedParentId,
      isDeleted: false,
    }).sort({ name: 1 });

    return children;
  }

  /**
   * Renames a folder
   */
  async renameFolder(ownerId: string, folderId: string, newName: string): Promise<IFolder> {
    if (!mongoose.Types.ObjectId.isValid(folderId)) {
      throw new BadRequestError('Invalid folder ID', 'INVALID_FOLDER_ID');
    }

    const folder = await Folder.findById(folderId);
    if (!folder || folder.isDeleted) {
      throw new NotFoundError('Folder not found', 'FOLDER_NOT_FOUND');
    }

    if (folder.ownerId.toString() !== ownerId) {
      throw new UnauthorizedError('You do not have permission to rename this folder', 'FORBIDDEN');
    }

    if (folder.name === newName) {
      return folder;
    }

    // Check for duplicate name in same parent
    const existing = await Folder.findOne({
      ownerId,
      parentId: folder.parentId,
      name: newName,
      isDeleted: false,
      _id: { $ne: folder._id },
    });

    if (existing) {
      throw new ConflictError(
        `A folder named '${newName}' already exists in this location`,
        'FOLDER_ALREADY_EXISTS'
      );
    }

    folder.name = newName;
    await folder.save();

    logger.info({ folderId: folder._id, newName }, 'Folder renamed successfully');

    return folder;
  }

  /**
   * Soft deletes a folder and recursively marks all descendant folders as deleted
   */
  async deleteFolder(ownerId: string, folderId: string): Promise<void> {
    if (!mongoose.Types.ObjectId.isValid(folderId)) {
      throw new BadRequestError('Invalid folder ID', 'INVALID_FOLDER_ID');
    }

    const folder = await Folder.findById(folderId);
    if (!folder || folder.isDeleted) {
      throw new NotFoundError('Folder not found', 'FOLDER_NOT_FOUND');
    }

    if (folder.ownerId.toString() !== ownerId) {
      throw new UnauthorizedError('You do not have permission to delete this folder', 'FORBIDDEN');
    }

    // Gather all descendant IDs via BFS to cascade soft-delete
    const descendantIds = await this.getAllDescendantIds(ownerId, folder._id as Types.ObjectId);
    const allIdsToDelete = [folder._id, ...descendantIds];

    const now = new Date();
    await Folder.updateMany(
      { _id: { $in: allIdsToDelete }, ownerId },
      { $set: { isDeleted: true, deletedAt: now } }
    );

    logger.info(
      { folderId, totalDeleted: allIdsToDelete.length },
      'Folder and descendants deleted successfully'
    );
  }

  /**
   * Moves a folder to a new parent folder or to root with cycle prevention
   */
  async moveFolder(ownerId: string, folderId: string, targetParentId: string | null): Promise<IFolder> {
    if (!mongoose.Types.ObjectId.isValid(folderId)) {
      throw new BadRequestError('Invalid folder ID', 'INVALID_FOLDER_ID');
    }

    const folder = await Folder.findById(folderId);
    if (!folder || folder.isDeleted) {
      throw new NotFoundError('Folder not found', 'FOLDER_NOT_FOUND');
    }

    if (folder.ownerId.toString() !== ownerId) {
      throw new UnauthorizedError('You do not have permission to move this folder', 'FORBIDDEN');
    }

    let normalizedTargetId: Types.ObjectId | null = null;

    if (targetParentId && targetParentId !== 'root') {
      if (!mongoose.Types.ObjectId.isValid(targetParentId)) {
        throw new BadRequestError('Invalid destination folder ID', 'INVALID_TARGET_ID');
      }

      // Check self-move
      if (targetParentId === folderId) {
        throw new BadRequestError('Cannot move a folder into itself', 'INVALID_MOVE_DESTINATION');
      }

      const targetParent = await Folder.findById(targetParentId);
      if (!targetParent || targetParent.isDeleted) {
        throw new NotFoundError('Destination folder not found', 'DESTINATION_NOT_FOUND');
      }

      if (targetParent.ownerId.toString() !== ownerId) {
        throw new UnauthorizedError('You do not have permission to move to this destination', 'FORBIDDEN');
      }

      // Cycle prevention: verify targetParent is not a descendant of folder
      const isDescendant = await this.isDescendantOf(targetParent, folder._id as Types.ObjectId);
      if (isDescendant) {
        throw new BadRequestError(
          'Cannot move a folder into one of its own subfolders',
          'CANNOT_MOVE_INTO_DESCENDANT'
        );
      }

      normalizedTargetId = targetParent._id as Types.ObjectId;
    }

    // If destination is same as current, return immediately (idempotent)
    const currentParentStr = folder.parentId ? folder.parentId.toString() : null;
    const targetParentStr = normalizedTargetId ? normalizedTargetId.toString() : null;
    if (currentParentStr === targetParentStr) {
      return folder;
    }

    // Check name collision at destination
    const collision = await Folder.findOne({
      ownerId,
      parentId: normalizedTargetId,
      name: folder.name,
      isDeleted: false,
      _id: { $ne: folder._id },
    });

    if (collision) {
      throw new ConflictError(
        `A folder named '${folder.name}' already exists in the destination`,
        'FOLDER_ALREADY_EXISTS'
      );
    }

    folder.parentId = normalizedTargetId;
    await folder.save();

    logger.info({ folderId: folder._id, destination: normalizedTargetId }, 'Folder moved successfully');

    return folder;
  }

  /**
   * Returns all active folders for an owner (useful for folder selection UI)
   */
  async getAllFolders(ownerId: string): Promise<IFolder[]> {
    return Folder.find({
      ownerId: new Types.ObjectId(ownerId),
      isDeleted: false,
    }).sort({ name: 1 });
  }

  /**
   * Builds ordered breadcrumbs from root to current folder
   */
  private async getBreadcrumbs(ownerId: string, currentFolder: IFolder): Promise<BreadcrumbItem[]> {
    const breadcrumbs: BreadcrumbItem[] = [
      {
        _id: currentFolder._id.toString(),
        name: currentFolder.name,
        parentId: currentFolder.parentId ? currentFolder.parentId.toString() : null,
      },
    ];

    let currentParentId = currentFolder.parentId;
    const visited = new Set<string>();

    while (currentParentId) {
      const parentIdStr = currentParentId.toString();
      if (visited.has(parentIdStr)) break;
      visited.add(parentIdStr);

      const parent = await Folder.findOne({
        _id: currentParentId,
        ownerId,
        isDeleted: false,
      });

      if (!parent) break;

      breadcrumbs.unshift({
        _id: parent._id.toString(),
        name: parent.name,
        parentId: parent.parentId ? parent.parentId.toString() : null,
      });

      currentParentId = parent.parentId;
    }

    return breadcrumbs;
  }

  /**
   * Checks if candidate is a descendant of ancestorId by climbing up candidate's parents
   */
  private async isDescendantOf(candidate: IFolder, ancestorId: Types.ObjectId): Promise<boolean> {
    let currParentId = candidate.parentId;
    const visited = new Set<string>();

    while (currParentId) {
      const parentIdStr = currParentId.toString();
      if (parentIdStr === ancestorId.toString()) {
        return true;
      }
      if (visited.has(parentIdStr)) break;
      visited.add(parentIdStr);

      const parent = await Folder.findById(currParentId);
      if (!parent) break;
      currParentId = parent.parentId;
    }

    return false;
  }

  /**
   * BFS helper to collect all descendant folder IDs
   */
  private async getAllDescendantIds(ownerId: string, folderId: Types.ObjectId): Promise<Types.ObjectId[]> {
    const descendantIds: Types.ObjectId[] = [];
    const queue: Types.ObjectId[] = [folderId];
    const visited = new Set<string>([folderId.toString()]);

    while (queue.length > 0) {
      const currentId = queue.shift()!;
      const children = await Folder.find({
        ownerId,
        parentId: currentId,
        isDeleted: false,
      }).select('_id');

      for (const child of children) {
        const id = child._id as Types.ObjectId;
        const idStr = id.toString();
        if (!visited.has(idStr)) {
          visited.add(idStr);
          descendantIds.push(id);
          queue.push(id);
        }
      }
    }

    return descendantIds;
  }
}

export const folderService = new FolderService();
