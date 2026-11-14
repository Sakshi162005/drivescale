import { describe, it, expect, vi, beforeEach } from 'vitest';
import mongoose, { Types } from 'mongoose';
import { Readable } from 'stream';
import { UploadService } from '../../src/services/upload.service.js';
import { UploadSession } from '../../src/models/UploadSession.js';
import { File } from '../../src/models/File.js';
import { Folder } from '../../src/models/Folder.js';
import { User } from '../../src/models/User.js';
import { IStorageService } from '../../src/services/storage/index.js';
import { BadRequestError, ConflictError, NotFoundError, ForbiddenError } from '../../src/utils/errors.js';
import { cacheService } from '../../src/services/cache.service.js';

describe('UploadService Unit Tests', () => {
  let uploadService: UploadService;
  let mockStorage: IStorageService;

  const userId = new mongoose.Types.ObjectId().toString();

  const mockUser = {
    _id: new mongoose.Types.ObjectId(userId),
    storageQuota: 10 * 1024 * 1024 * 1024, // 10 GB
    storageUsed: 1024 * 1024,
    storageReserved: 0,
    isActive: true,
  };

  beforeEach(() => {
    vi.restoreAllMocks();

    mockStorage = {
      upload: vi.fn().mockResolvedValue({ size: 1024, checksum: 'assembled-checksum' }),
      download: vi.fn(),
      createReadStream: vi.fn(),
      delete: vi.fn().mockResolvedValue(undefined),
      exists: vi.fn().mockResolvedValue(true),
      getMetadata: vi.fn(),
      saveChunk: vi.fn().mockResolvedValue({ size: 512, checksum: 'chunk-sha256' }),
      chunkExists: vi.fn().mockResolvedValue(true),
      deleteChunks: vi.fn().mockResolvedValue(undefined),
      assembleChunks: vi.fn().mockResolvedValue({ size: 1024, checksum: 'assembled-checksum' }),
    };

    uploadService = new UploadService(mockStorage);

    vi.spyOn(cacheService, 'del').mockResolvedValue(undefined);
    vi.spyOn(cacheService, 'delByPattern').mockResolvedValue(undefined);
    vi.spyOn(File, 'findOne').mockResolvedValue(null);
  });

  describe('1. Session Initialization & Quota Accounting', () => {
    it('creates upload session and atomically reserves storage quota', async () => {
      vi.spyOn(User, 'findById').mockResolvedValue(mockUser as any);
      vi.spyOn(User, 'findOneAndUpdate').mockResolvedValue(mockUser as any);
      vi.spyOn(UploadSession, 'create').mockResolvedValue({
        _id: new mongoose.Types.ObjectId(),
        userId: new mongoose.Types.ObjectId(userId),
        fileName: 'dataset.tar.gz',
        totalSize: 1024 * 1024,
        chunkSize: 524288,
        totalChunks: 2,
        status: 'PENDING',
        reservedBytes: 1024 * 1024,
        expiresAt: new Date(Date.now() + 86400000),
      } as any);

      const session = await uploadService.initUpload(userId, {
        fileName: 'dataset.tar.gz',
        totalSize: 1024 * 1024,
      });

      expect(User.findOneAndUpdate).toHaveBeenCalled();
      expect(session.fileName).toBe('dataset.tar.gz');
      expect(session.totalChunks).toBe(2);
    });

    it('rejects session initialization when filename is invalid', async () => {
      await expect(
        uploadService.initUpload(userId, {
          fileName: '   ',
          totalSize: 1024,
        })
      ).rejects.toThrow(BadRequestError);

      await expect(
        uploadService.initUpload(userId, {
          fileName: '////',
          totalSize: 1024,
        })
      ).rejects.toThrow(BadRequestError);
    });

    it('rejects session initialization when requested size exceeds available storage quota', async () => {
      vi.spyOn(User, 'findById').mockResolvedValue(mockUser as any);
      // findOneAndUpdate returning null signifies condition was not met (quota exceeded)
      vi.spyOn(User, 'findOneAndUpdate').mockResolvedValue(null);

      await expect(
        uploadService.initUpload(userId, {
          fileName: 'huge-file.iso',
          totalSize: 20 * 1024 * 1024 * 1024, // 20 GB > 10 GB
        })
      ).rejects.toThrow(/Storage quota exceeded/);
    });
  });

  describe('2. Chunk Ingestion, Validation & Idempotency', () => {
    it('saves chunk, computes SHA-256 and updates session progress', async () => {
      const uploadId = new mongoose.Types.ObjectId().toString();
      const mockSession = {
        _id: new mongoose.Types.ObjectId(uploadId),
        userId: new mongoose.Types.ObjectId(userId),
        fileName: 'test.bin',
        totalSize: 1024,
        chunkSize: 512,
        totalChunks: 2,
        status: 'PENDING',
        uploadedChunks: [] as any[],
        expiresAt: new Date(Date.now() + 86400000),
        save: vi.fn().mockResolvedValue(true),
      };

      vi.spyOn(UploadSession, 'findById').mockResolvedValue(mockSession as any);

      const chunkStream = Readable.from(Buffer.from('chunk data 0'));
      const result = await uploadService.uploadChunk(
        userId,
        uploadId,
        0,
        chunkStream,
        512
      );

      expect(mockStorage.saveChunk).toHaveBeenCalled();
      expect(result.chunkNumber).toBe(0);
      expect(result.isDuplicate).toBe(false);
      expect(mockSession.status).toBe('UPLOADING');
      expect(mockSession.uploadedChunks.length).toBe(1);
    });

    it('idempotently handles identical duplicate chunk uploads', async () => {
      const uploadId = new mongoose.Types.ObjectId().toString();
      const mockSession = {
        _id: new mongoose.Types.ObjectId(uploadId),
        userId: new mongoose.Types.ObjectId(userId),
        fileName: 'test.bin',
        totalSize: 1024,
        chunkSize: 512,
        totalChunks: 2,
        status: 'UPLOADING',
        uploadedChunks: [{ chunkNumber: 0, size: 512, checksum: 'chunk-sha256' }],
        expiresAt: new Date(Date.now() + 86400000),
        save: vi.fn().mockResolvedValue(true),
      };

      vi.spyOn(UploadSession, 'findById').mockResolvedValue(mockSession as any);

      const duplicateStream = Readable.from(Buffer.from('chunk data 0 again'));
      const result = await uploadService.uploadChunk(
        userId,
        uploadId,
        0,
        duplicateStream,
        512
      );

      expect(result.isDuplicate).toBe(true);
      expect(result.chunkNumber).toBe(0);
    });

    it('rejects duplicate chunk with conflicting checksum (409 Conflict)', async () => {
      const uploadId = new mongoose.Types.ObjectId().toString();
      const mockSession = {
        _id: new mongoose.Types.ObjectId(uploadId),
        userId: new mongoose.Types.ObjectId(userId),
        fileName: 'test.bin',
        totalSize: 1024,
        chunkSize: 512,
        totalChunks: 2,
        status: 'UPLOADING',
        uploadedChunks: [{ chunkNumber: 0, size: 512, checksum: 'first-checksum' }],
        expiresAt: new Date(Date.now() + 86400000),
      };

      vi.spyOn(UploadSession, 'findById').mockResolvedValue(mockSession as any);
      vi.spyOn(mockStorage, 'saveChunk').mockResolvedValue({ size: 512, checksum: 'different-checksum' });

      const conflictStream = Readable.from(Buffer.from('corrupted different data'));
      await expect(
        uploadService.uploadChunk(
          userId,
          uploadId,
          0,
          conflictStream,
          512
        )
      ).rejects.toThrow(ConflictError);
    });

    it('rejects chunk ingestion when session has expired', async () => {
      const uploadId = new mongoose.Types.ObjectId().toString();
      const expiredSession = {
        _id: new mongoose.Types.ObjectId(uploadId),
        userId: new mongoose.Types.ObjectId(userId),
        status: 'UPLOADING',
        expiresAt: new Date(Date.now() - 3600000), // 1 hr ago
        save: vi.fn().mockResolvedValue(true),
      };

      vi.spyOn(UploadSession, 'findById').mockResolvedValue(expiredSession as any);

      const stream = Readable.from(Buffer.from('late chunk'));
      await expect(
        uploadService.uploadChunk(userId, uploadId, 0, stream)
      ).rejects.toThrow(/expired/);
    });
  });

  describe('3. Completion, Assembly & Finalization', () => {
    it('assembles chunks, creates File metadata, and updates quota balances', async () => {
      const uploadId = new mongoose.Types.ObjectId().toString();
      const sessionDoc = {
        _id: new mongoose.Types.ObjectId(uploadId),
        userId: new mongoose.Types.ObjectId(userId),
        fileName: 'completed.zip',
        totalSize: 1024,
        chunkSize: 512,
        totalChunks: 2,
        status: 'UPLOADING',
        uploadedChunks: [
          { chunkNumber: 0, size: 512, checksum: 'c0' },
          { chunkNumber: 1, size: 512, checksum: 'c1' },
        ],
        storageKey: 'objects/aa/completed.zip',
        reservedBytes: 1024,
        folderId: null,
        expiresAt: new Date(Date.now() + 86400000),
        save: vi.fn().mockResolvedValue(true),
      };

      vi.spyOn(UploadSession, 'findById').mockResolvedValue(sessionDoc as any);
      vi.spyOn(UploadSession, 'findOneAndUpdate').mockResolvedValue(sessionDoc as any);
      vi.spyOn(File, 'findOne').mockResolvedValue(null);
      vi.spyOn(File, 'create').mockResolvedValue({
        _id: new mongoose.Types.ObjectId(),
        name: 'completed.zip',
        ownerId: new mongoose.Types.ObjectId(userId),
        size: 1024,
        storageKey: 'objects/aa/completed.zip',
        mimeType: 'application/zip',
        checksum: 'mock-checksum',
      } as any);
      vi.spyOn(User, 'findByIdAndUpdate').mockResolvedValue({} as any);

      const file = await uploadService.completeUpload(userId, uploadId);

      expect(mockStorage.assembleChunks).toHaveBeenCalledWith(uploadId, 2, 'objects/aa/completed.zip');
      expect(File.create).toHaveBeenCalled();
      expect(User.findByIdAndUpdate).toHaveBeenCalled();
      expect(file.name).toBe('completed.zip');
    });

    it('rejects completion when missing chunks remain', async () => {
      const uploadId = new mongoose.Types.ObjectId().toString();
      const sessionDoc = {
        _id: new mongoose.Types.ObjectId(uploadId),
        userId: new mongoose.Types.ObjectId(userId),
        fileName: 'incomplete.zip',
        totalSize: 1024,
        chunkSize: 512,
        totalChunks: 2,
        status: 'UPLOADING',
        uploadedChunks: [{ chunkNumber: 0, size: 512, checksum: 'c0' }], // Missing chunk 1
        expiresAt: new Date(Date.now() + 86400000),
      };

      vi.spyOn(UploadSession, 'findById').mockResolvedValue(sessionDoc as any);
      vi.spyOn(UploadSession, 'findOneAndUpdate').mockResolvedValue(sessionDoc as any);
      vi.spyOn(UploadSession, 'findByIdAndUpdate').mockResolvedValue({} as any);

      await expect(uploadService.completeUpload(userId, uploadId)).rejects.toThrow(BadRequestError);
    });
  });

  describe('4. Session Cancellation & Resource Cleanup', () => {
    it('cancels active session, deletes staged chunks, and releases reserved quota', async () => {
      const uploadId = new mongoose.Types.ObjectId().toString();
      const sessionDoc = {
        _id: new mongoose.Types.ObjectId(uploadId),
        userId: new mongoose.Types.ObjectId(userId),
        status: 'UPLOADING',
        reservedBytes: 2048,
        save: vi.fn().mockResolvedValue(true),
      };

      vi.spyOn(UploadSession, 'findById').mockResolvedValue(sessionDoc as any);
      vi.spyOn(User, 'findByIdAndUpdate').mockResolvedValue({} as any);

      await uploadService.cancelUpload(userId, uploadId);

      expect(sessionDoc.status).toBe('CANCELLED');
      expect(mockStorage.deleteChunks).toHaveBeenCalledWith(uploadId);
      expect(User.findByIdAndUpdate).toHaveBeenCalledWith(
        expect.anything(),
        { $inc: { storageReserved: -2048 } }
      );
    });

    it('rejects cancellation of already completed session (400)', async () => {
      const uploadId = new mongoose.Types.ObjectId().toString();
      const completedSession = {
        _id: new mongoose.Types.ObjectId(uploadId),
        userId: new mongoose.Types.ObjectId(userId),
        status: 'COMPLETED',
      };

      vi.spyOn(UploadSession, 'findById').mockResolvedValue(completedSession as any);

      await expect(uploadService.cancelUpload(userId, uploadId)).rejects.toThrow(BadRequestError);
    });
  });
});

