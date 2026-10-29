import mongoose, { Types } from 'mongoose';
import crypto from 'crypto';
import { File, IFile } from '../models/File.js';
import { Folder } from '../models/Folder.js';
import { User } from '../models/User.js';
import { storageService, IStorageService } from './storage/index.js';
import { ListFilesQueryInput } from '../schemas/file.schema.js';
import {
  BadRequestError,
  ConflictError,
  NotFoundError,
  UnauthorizedError,
} from '../utils/errors.js';
import { logger } from '../utils/logger.js';

export interface UploadFileInput {
  folderId?: string | null;
  fileName: string;
  mimeType: string;
  stream: NodeJS.ReadableStream;
}

export interface PaginatedFilesResult {
  files: IFile[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
    hasNextPage: boolean;
    hasPrevPage: boolean;
  };
}

export class FileService {
  private readonly storage: IStorageService;

  constructor(customStorage?: IStorageService) {
    this.storage = customStorage || storageService;
  }

  /**
   * Generates a safe randomized storage key with 2-level directory sharding
   * Example: objects/3f/3fe29bc412a870dc02ab5501
   */
  private generateStorageKey(): string {
    const hash = crypto.randomBytes(16).toString('hex');
    const prefix = hash.slice(0, 2);
    return `objects/${prefix}/${hash}`;
  }

  /**
   * Validates and streams an uploaded file to storage, creating the MongoDB record
   */
  async uploadFile(ownerId: string, input: UploadFileInput): Promise<IFile> {
    const sanitizedName = input.fileName.trim();
    if (!sanitizedName || /^[/\\<>:"|?*]+$/.test(sanitizedName)) {
      input.stream.resume();
      throw new BadRequestError('Invalid file name', 'INVALID_FILE_NAME');
    }

    const storageKey = this.generateStorageKey();

    // Stream upload directly to storage immediately so incoming stream is consumed without deadlock
    const { size, checksum } = await this.storage.upload(storageKey, input.stream);

    const cleanupAndThrow = async (err: Error): Promise<never> => {
      try {
        await this.storage.delete(storageKey);
      } catch {
        // Ignore cleanup error
      }
      throw err;
    };

    let normalizedFolderId: Types.ObjectId | null = null;

    if (input.folderId && input.folderId !== 'root') {
      if (!mongoose.Types.ObjectId.isValid(input.folderId)) {
        await cleanupAndThrow(new BadRequestError('Invalid folder ID', 'INVALID_FOLDER_ID'));
      }

      const folder = await Folder.findById(input.folderId);
      if (!folder || folder.isDeleted) {
        await cleanupAndThrow(new NotFoundError('Destination folder not found', 'FOLDER_NOT_FOUND'));
      }

      if (folder!.ownerId.toString() !== ownerId) {
        await cleanupAndThrow(new UnauthorizedError('You do not have permission to upload to this folder', 'FORBIDDEN'));
      }

      normalizedFolderId = folder!._id as Types.ObjectId;
    }

    // Check duplicate file name in the destination folder
    const existingFile = await File.findOne({
      ownerId,
      folderId: normalizedFolderId,
      name: sanitizedName,
      isDeleted: false,
    });

    if (existingFile) {
      await cleanupAndThrow(
        new ConflictError(
          `A file named '${sanitizedName}' already exists in this folder`,
          'FILE_ALREADY_EXISTS'
        )
      );
    }

    // Verify user storage quota with actual uploaded size
    const user = await User.findById(ownerId);
    if (!user) {
      await cleanupAndThrow(new NotFoundError('User not found', 'USER_NOT_FOUND'));
    }

    if (user!.storageUsed + size > user!.storageQuota) {
      await cleanupAndThrow(
        new BadRequestError('Storage quota exceeded. Please free up space before uploading.', 'STORAGE_QUOTA_EXCEEDED')
      );
    }

    try {
      // Update user storage usage
      await User.findByIdAndUpdate(ownerId, { $inc: { storageUsed: size } });

      const file = await File.create({
        name: sanitizedName,
        ownerId: new Types.ObjectId(ownerId),
        folderId: normalizedFolderId,
        storageKey,
        size,
        mimeType: input.mimeType || 'application/octet-stream',
        checksum,
      });

      logger.info({ fileId: file._id, ownerId, size, storageKey }, 'File uploaded successfully');
      return file;
    } catch (dbError) {
      // Rollback storage file on database failure
      await this.storage.delete(storageKey);
      await User.findByIdAndUpdate(ownerId, { $inc: { storageUsed: -size } });
      throw dbError;
    }
  }

  /**
   * Retrieves paginated files for a user in a specific folder or across all folders
   */
  async listFiles(ownerId: string, query: ListFilesQueryInput): Promise<PaginatedFilesResult> {
    const page = Math.max(1, query.page || 1);
    const limit = Math.min(100, Math.max(1, query.limit || 50));
    const skip = (page - 1) * limit;

    const filter: Record<string, unknown> = {
      ownerId: new Types.ObjectId(ownerId),
      isDeleted: false,
    };

    if (query.folderId === 'all') {
      // List across all folders
    } else if (!query.folderId || query.folderId === 'root' || query.folderId === 'null') {
      filter['folderId'] = null;
    } else {
      if (!mongoose.Types.ObjectId.isValid(query.folderId)) {
        throw new BadRequestError('Invalid folder ID', 'INVALID_FOLDER_ID');
      }

      const folder = await Folder.findById(query.folderId);
      if (!folder || folder.isDeleted) {
        throw new NotFoundError('Folder not found', 'FOLDER_NOT_FOUND');
      }

      if (folder.ownerId.toString() !== ownerId) {
        throw new UnauthorizedError('You do not have permission to access this folder', 'FORBIDDEN');
      }

      filter['folderId'] = new Types.ObjectId(query.folderId);
    }

    const sortField = query.sortBy || 'name';
    const sortOrder = query.sortOrder === 'desc' ? -1 : 1;

    const [files, total] = await Promise.all([
      File.find(filter)
        .sort({ [sortField]: sortOrder })
        .skip(skip)
        .limit(limit),
      File.countDocuments(filter),
    ]);

    const totalPages = Math.ceil(total / limit) || 1;

    return {
      files,
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
   * Retrieves file metadata with authorization check
   */
  async getFile(ownerId: string, fileId: string): Promise<IFile> {
    if (!mongoose.Types.ObjectId.isValid(fileId)) {
      throw new BadRequestError('Invalid file ID', 'INVALID_FILE_ID');
    }

    const file = await File.findById(fileId);
    if (!file || file.isDeleted) {
      throw new NotFoundError('File not found', 'FILE_NOT_FOUND');
    }

    if (file.ownerId.toString() !== ownerId) {
      throw new UnauthorizedError('You do not have permission to access this file', 'FORBIDDEN');
    }

    return file;
  }

  /**
   * Retrieves file and creates readable stream for download
   */
  async getFileForDownload(ownerId: string, fileId: string): Promise<{ file: IFile; stream: NodeJS.ReadableStream }> {
    const file = await this.getFile(ownerId, fileId);
    const stream = await this.storage.createReadStream(file.storageKey);
    return { file, stream };
  }

  /**
   * Renames a file
   */
  async renameFile(ownerId: string, fileId: string, newName: string): Promise<IFile> {
    const sanitizedName = newName.trim();
    if (!sanitizedName) {
      throw new BadRequestError('File name cannot be empty', 'INVALID_FILE_NAME');
    }

    const file = await this.getFile(ownerId, fileId);
    if (file.name === sanitizedName) {
      return file;
    }

    // Check duplicate name in same folder
    const collision = await File.findOne({
      ownerId,
      folderId: file.folderId,
      name: sanitizedName,
      isDeleted: false,
      _id: { $ne: file._id },
    });

    if (collision) {
      throw new ConflictError(
        `A file named '${sanitizedName}' already exists in this location`,
        'FILE_ALREADY_EXISTS'
      );
    }

    file.name = sanitizedName;
    await file.save();

    logger.info({ fileId: file._id, newName: sanitizedName }, 'File renamed successfully');
    return file;
  }

  /**
   * Moves a file to another folder or to root
   */
  async moveFile(ownerId: string, fileId: string, targetFolderId: string | null): Promise<IFile> {
    const file = await this.getFile(ownerId, fileId);

    let normalizedTargetId: Types.ObjectId | null = null;

    if (targetFolderId && targetFolderId !== 'root') {
      if (!mongoose.Types.ObjectId.isValid(targetFolderId)) {
        throw new BadRequestError('Invalid destination folder ID', 'INVALID_TARGET_ID');
      }

      const targetFolder = await Folder.findById(targetFolderId);
      if (!targetFolder || targetFolder.isDeleted) {
        throw new NotFoundError('Destination folder not found', 'DESTINATION_NOT_FOUND');
      }

      if (targetFolder.ownerId.toString() !== ownerId) {
        throw new UnauthorizedError('You do not have permission to move files into this folder', 'FORBIDDEN');
      }

      normalizedTargetId = targetFolder._id as Types.ObjectId;
    }

    const currentFolderStr = file.folderId ? file.folderId.toString() : null;
    const targetFolderStr = normalizedTargetId ? normalizedTargetId.toString() : null;

    if (currentFolderStr === targetFolderStr) {
      return file;
    }

    // Check collision at destination
    const collision = await File.findOne({
      ownerId,
      folderId: normalizedTargetId,
      name: file.name,
      isDeleted: false,
      _id: { $ne: file._id },
    });

    if (collision) {
      throw new ConflictError(
        `A file named '${file.name}' already exists in the destination folder`,
        'FILE_ALREADY_EXISTS'
      );
    }

    file.folderId = normalizedTargetId;
    await file.save();

    logger.info({ fileId: file._id, targetFolder: normalizedTargetId }, 'File moved successfully');
    return file;
  }

  /**
   * Soft deletes a file and updates user storage usage
   */
  async deleteFile(ownerId: string, fileId: string): Promise<void> {
    const file = await this.getFile(ownerId, fileId);

    file.isDeleted = true;
    file.deletedAt = new Date();
    await file.save();

    // Decrement user storage usage
    await User.findByIdAndUpdate(ownerId, {
      $inc: { storageUsed: -file.size },
    });

    logger.info({ fileId, size: file.size, ownerId }, 'File soft deleted successfully');
  }
}

export const fileService = new FileService();
