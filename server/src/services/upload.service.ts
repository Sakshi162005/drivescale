import mongoose, { Types } from 'mongoose';
import crypto from 'crypto';
import { UploadSession, IUploadSession } from '../models/UploadSession.js';
import { File, IFile } from '../models/File.js';
import { Folder } from '../models/Folder.js';
import { User } from '../models/User.js';
import { storageService, IStorageService } from './storage/index.js';
import { InitUploadInput, DEFAULT_CHUNK_SIZE } from '../schemas/upload.schema.js';
import {
  BadRequestError,
  ConflictError,
  NotFoundError,
  UnauthorizedError,
} from '../utils/errors.js';
import { logger } from '../utils/logger.js';

export interface ChunkUploadResult {
  chunkNumber: number;
  size: number;
  checksum: string;
  isDuplicate: boolean;
  uploadedChunksCount: number;
  totalChunks: number;
}

export class UploadService {
  private readonly storage: IStorageService;

  constructor(customStorage?: IStorageService) {
    this.storage = customStorage || storageService;
  }

  /**
   * Generates a collision-resistant storage key with two-level directory sharding
   */
  private generateStorageKey(): string {
    const hash = crypto.randomBytes(16).toString('hex');
    const prefix = hash.slice(0, 2);
    return `objects/${prefix}/${hash}`;
  }

  /**
   * Initializes a new chunked upload session
   */
  async initUpload(userId: string, input: InitUploadInput): Promise<IUploadSession> {
    const sanitizedName = input.fileName.trim();
    if (!sanitizedName || /^[/\\<>:"|?*]+$/.test(sanitizedName)) {
      throw new BadRequestError('Invalid file name', 'INVALID_FILE_NAME');
    }

    let normalizedFolderId: Types.ObjectId | null = null;

    if (input.folderId && input.folderId !== 'root') {
      if (!mongoose.Types.ObjectId.isValid(input.folderId)) {
        throw new BadRequestError('Invalid folder ID', 'INVALID_FOLDER_ID');
      }

      const folder = await Folder.findById(input.folderId);
      if (!folder || folder.isDeleted) {
        throw new NotFoundError('Destination folder not found', 'FOLDER_NOT_FOUND');
      }

      if (folder.ownerId.toString() !== userId) {
        throw new UnauthorizedError('You do not have permission to upload to this folder', 'FORBIDDEN');
      }

      normalizedFolderId = folder._id as Types.ObjectId;
    }

    // Check duplicate file name in target folder
    const existingFile = await File.findOne({
      ownerId: new Types.ObjectId(userId),
      folderId: normalizedFolderId,
      name: sanitizedName,
      isDeleted: false,
    });

    if (existingFile) {
      throw new ConflictError(
        `A file named '${sanitizedName}' already exists in this folder`,
        'FILE_ALREADY_EXISTS'
      );
    }

    // Check user storage quota
    const user = await User.findById(userId);
    if (!user) {
      throw new NotFoundError('User not found', 'USER_NOT_FOUND');
    }

    if (user.storageUsed + input.totalSize > user.storageQuota) {
      throw new BadRequestError(
        'Storage quota exceeded. Please free up space before uploading.',
        'STORAGE_QUOTA_EXCEEDED'
      );
    }

    const chunkSize = input.chunkSize || DEFAULT_CHUNK_SIZE;
    const totalChunks = input.totalSize === 0 ? 1 : Math.ceil(input.totalSize / chunkSize);

    const storageKey = this.generateStorageKey();
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours expiry

    const session = await UploadSession.create({
      userId: new Types.ObjectId(userId),
      fileName: sanitizedName,
      folderId: normalizedFolderId,
      mimeType: input.mimeType || 'application/octet-stream',
      totalSize: input.totalSize,
      chunkSize,
      totalChunks,
      uploadedChunks: [],
      storageKey,
      status: 'PENDING',
      expiresAt,
    });

    logger.info(
      { uploadId: session._id, userId, totalChunks, chunkSize, totalSize: input.totalSize },
      'Chunked upload session initialized'
    );

    return session;
  }

  /**
   * Uploads and validates an individual chunk
   */
  async uploadChunk(
    userId: string,
    uploadId: string,
    chunkNumber: number,
    stream: NodeJS.ReadableStream
  ): Promise<ChunkUploadResult> {
    const drainAndThrow = (err: Error): never => {
      if (stream && 'resume' in stream && typeof stream.resume === 'function') {
        stream.resume();
      }
      throw err;
    };

    if (!mongoose.Types.ObjectId.isValid(uploadId)) {
      drainAndThrow(new BadRequestError('Invalid upload session ID', 'INVALID_UPLOAD_ID'));
    }

    const session = await UploadSession.findById(uploadId);
    if (!session) {
      drainAndThrow(new NotFoundError('Upload session not found', 'SESSION_NOT_FOUND'));
    }

    if (session!.userId.toString() !== userId) {
      drainAndThrow(new UnauthorizedError('You do not have permission to access this upload session', 'FORBIDDEN'));
    }

    if (session!.status === 'COMPLETED') {
      drainAndThrow(new BadRequestError('Upload session has already been completed', 'SESSION_ALREADY_COMPLETED'));
    }

    if (session!.status === 'CANCELLED' || session!.status === 'FAILED') {
      drainAndThrow(new BadRequestError(`Cannot upload chunks to a ${session!.status.toLowerCase()} session`, 'INVALID_SESSION_STATE'));
    }

    if (new Date() > session!.expiresAt) {
      session!.status = 'EXPIRED';
      await session!.save();
      drainAndThrow(new BadRequestError('Upload session has expired', 'SESSION_EXPIRED'));
    }

    if (chunkNumber < 0 || chunkNumber >= session!.totalChunks) {
      drainAndThrow(
        new BadRequestError(
          `Chunk number ${chunkNumber} out of bounds. Expected 0 to ${session!.totalChunks - 1}`,
          'INVALID_CHUNK_NUMBER'
        )
      );
    }

    // Calculate expected chunk size
    let expectedSize: number;
    if (session!.totalSize === 0) {
      expectedSize = 0;
    } else if (chunkNumber === session!.totalChunks - 1) {
      expectedSize = session!.totalSize - (session!.totalChunks - 1) * session!.chunkSize;
    } else {
      expectedSize = session!.chunkSize;
    }

    // Save chunk to storage
    const { size, checksum } = await this.storage.saveChunk(uploadId, chunkNumber, stream);

    if (size !== expectedSize) {
      throw new BadRequestError(
        `Invalid chunk size for chunk ${chunkNumber}. Expected ${expectedSize} bytes, received ${size} bytes`,
        'INVALID_CHUNK_SIZE'
      );
    }

    // Check duplicate chunk
    const existingChunk = session!.uploadedChunks.find((c) => c.chunkNumber === chunkNumber);
    if (existingChunk) {
      if (existingChunk.checksum === checksum) {
        logger.info({ uploadId, chunkNumber }, 'Duplicate identical chunk received (idempotent)');
        return {
          chunkNumber,
          size,
          checksum,
          isDuplicate: true,
          uploadedChunksCount: session!.uploadedChunks.length,
          totalChunks: session!.totalChunks,
        };
      } else {
        logger.warn({ uploadId, chunkNumber }, 'Duplicate chunk received with conflicting checksum');
        throw new ConflictError(
          `Chunk ${chunkNumber} already uploaded with a different checksum`,
          'DUPLICATE_CHUNK_CONFLICT'
        );
      }
    }

    // Add chunk and update status
    session!.uploadedChunks.push({
      chunkNumber,
      size,
      checksum,
      uploadedAt: new Date(),
    });

    if (session!.status === 'PENDING') {
      session!.status = 'UPLOADING';
    }

    await session!.save();

    logger.info(
      { uploadId, chunkNumber, size, progress: `${session!.uploadedChunks.length}/${session!.totalChunks}` },
      'Chunk uploaded and validated successfully'
    );

    return {
      chunkNumber,
      size,
      checksum,
      isDuplicate: false,
      uploadedChunksCount: session!.uploadedChunks.length,
      totalChunks: session!.totalChunks,
    };
  }

  /**
   * Completes a chunked upload by assembling all chunks into the final object
   */
  async completeUpload(userId: string, uploadId: string): Promise<IFile> {
    if (!mongoose.Types.ObjectId.isValid(uploadId)) {
      throw new BadRequestError('Invalid upload session ID', 'INVALID_UPLOAD_ID');
    }

    const session = await UploadSession.findById(uploadId);
    if (!session) {
      throw new NotFoundError('Upload session not found', 'SESSION_NOT_FOUND');
    }

    if (session.userId.toString() !== userId) {
      throw new UnauthorizedError('You do not have permission to access this upload session', 'FORBIDDEN');
    }

    // Handle repeated completion idempotently
    if (session.status === 'COMPLETED') {
      const existingFile = await File.findOne({ storageKey: session.storageKey, isDeleted: false });
      if (existingFile) {
        return existingFile;
      }
    }

    if (session.status === 'ASSEMBLING') {
      throw new ConflictError('Upload session is already being assembled', 'SESSION_ASSEMBLING');
    }

    if (session.status === 'CANCELLED' || session.status === 'FAILED') {
      throw new BadRequestError(`Cannot complete a ${session.status.toLowerCase()} upload session`, 'INVALID_SESSION_STATE');
    }

    if (new Date() > session.expiresAt) {
      session.status = 'EXPIRED';
      await session.save();
      throw new BadRequestError('Upload session has expired', 'SESSION_EXPIRED');
    }

    // Concurrency guard: atomically acquire ASSEMBLING state
    const updatedSession = await UploadSession.findOneAndUpdate(
      { _id: session._id, status: { $in: ['PENDING', 'UPLOADING'] } },
      { $set: { status: 'ASSEMBLING' } },
      { new: true }
    );

    if (!updatedSession) {
      throw new ConflictError('Concurrent completion in progress or invalid state', 'CONCURRENT_COMPLETION');
    }

    // Check all chunks exist
    const uploadedSet = new Set(updatedSession.uploadedChunks.map((c) => c.chunkNumber));
    const missingChunks: number[] = [];

    for (let i = 0; i < updatedSession.totalChunks; i++) {
      if (!uploadedSet.has(i)) {
        missingChunks.push(i);
      }
    }

    if (missingChunks.length > 0) {
      // Revert status to UPLOADING so missing chunks can still be supplied
      await UploadSession.findByIdAndUpdate(uploadId, { $set: { status: 'UPLOADING' } });
      throw new BadRequestError(
        `Cannot complete upload: missing chunks: [${missingChunks.join(', ')}]`,
        'MISSING_CHUNKS'
      );
    }

    // Assemble chunks
    let assembleResult;
    try {
      assembleResult = await this.storage.assembleChunks(
        uploadId,
        updatedSession.totalChunks,
        updatedSession.storageKey
      );
    } catch (assembleErr) {
      await UploadSession.findByIdAndUpdate(uploadId, { $set: { status: 'FAILED' } });
      logger.error({ uploadId, err: assembleErr }, 'Failed to assemble chunks');
      throw assembleErr;
    }

    // Validate assembled size
    if (assembleResult.size !== updatedSession.totalSize) {
      await this.storage.delete(updatedSession.storageKey);
      await UploadSession.findByIdAndUpdate(uploadId, { $set: { status: 'FAILED' } });
      throw new BadRequestError(
        `Assembled size (${assembleResult.size}) does not match expected total size (${updatedSession.totalSize})`,
        'SIZE_MISMATCH'
      );
    }

    try {
      // Increment user storage quota
      await User.findByIdAndUpdate(userId, { $inc: { storageUsed: assembleResult.size } });

      // Create File record in MongoDB
      const file = await File.create({
        name: updatedSession.fileName,
        ownerId: updatedSession.userId,
        folderId: updatedSession.folderId,
        storageKey: updatedSession.storageKey,
        size: assembleResult.size,
        mimeType: updatedSession.mimeType,
        checksum: assembleResult.checksum,
      });

      await UploadSession.findByIdAndUpdate(uploadId, { $set: { status: 'COMPLETED' } });

      logger.info({ fileId: file._id, uploadId, size: file.size }, 'Chunked upload completed successfully');
      return file;
    } catch (dbError) {
      // Rollback assembled file and storage allocation on DB error
      await this.storage.delete(updatedSession.storageKey);
      await User.findByIdAndUpdate(userId, { $inc: { storageUsed: -assembleResult.size } });
      await UploadSession.findByIdAndUpdate(uploadId, { $set: { status: 'FAILED' } });
      throw dbError;
    }
  }

  /**
   * Retrieves status of an upload session
   */
  async getUploadStatus(userId: string, uploadId: string): Promise<IUploadSession> {
    if (!mongoose.Types.ObjectId.isValid(uploadId)) {
      throw new BadRequestError('Invalid upload session ID', 'INVALID_UPLOAD_ID');
    }

    const session = await UploadSession.findById(uploadId);
    if (!session) {
      throw new NotFoundError('Upload session not found', 'SESSION_NOT_FOUND');
    }

    if (session.userId.toString() !== userId) {
      throw new UnauthorizedError('You do not have permission to access this upload session', 'FORBIDDEN');
    }

    return session;
  }

  /**
   * Cancels an upload session and cleans up stored chunks
   */
  async cancelUpload(userId: string, uploadId: string): Promise<void> {
    if (!mongoose.Types.ObjectId.isValid(uploadId)) {
      throw new BadRequestError('Invalid upload session ID', 'INVALID_UPLOAD_ID');
    }

    const session = await UploadSession.findById(uploadId);
    if (!session) {
      throw new NotFoundError('Upload session not found', 'SESSION_NOT_FOUND');
    }

    if (session.userId.toString() !== userId) {
      throw new UnauthorizedError('You do not have permission to cancel this upload session', 'FORBIDDEN');
    }

    session.status = 'CANCELLED';
    await session.save();

    await this.storage.deleteChunks(uploadId);
    logger.info({ uploadId, userId }, 'Upload session cancelled and temporary chunks deleted');
  }
}

export const uploadService = new UploadService();

