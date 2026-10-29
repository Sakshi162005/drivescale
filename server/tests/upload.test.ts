import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import request from 'supertest';
import mongoose from 'mongoose';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { createApp } from '../src/app.js';
import { UploadSession } from '../src/models/UploadSession.js';
import { File } from '../src/models/File.js';
import { Folder } from '../src/models/Folder.js';
import { User } from '../src/models/User.js';
import { signAccessToken } from '../src/utils/jwt.js';
import { LocalStorageService } from '../src/services/storage/local-storage.service.js';
import { storageService } from '../src/services/storage/index.js';

describe('Phase 4 Chunked Uploads Test Suite', () => {
  const app = createApp();

  const userAId = new mongoose.Types.ObjectId().toString();
  const userBId = new mongoose.Types.ObjectId().toString();

  const tokenUserA = signAccessToken({ userId: userAId, email: 'usera@example.com', role: 'user' });
  const tokenUserB = signAccessToken({ userId: userBId, email: 'userb@example.com', role: 'user' });

  const testStorageDir = path.join(os.tmpdir(), `drivescale-chunk-test-${Date.now()}`);
  const localStorage = new LocalStorageService(testStorageDir);

  afterAll(async () => {
    try {
      await fs.promises.rm(testStorageDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup error
    }
  });

  beforeEach(() => {
    vi.restoreAllMocks();

    // Route storageService calls to our isolated test LocalStorageService
    vi.spyOn(storageService, 'saveChunk').mockImplementation((...args) =>
      localStorage.saveChunk(...args)
    );
    vi.spyOn(storageService, 'chunkExists').mockImplementation((uploadId, chunkNum) =>
      localStorage.chunkExists(uploadId, chunkNum)
    );
    vi.spyOn(storageService, 'deleteChunks').mockImplementation((uploadId) =>
      localStorage.deleteChunks(uploadId)
    );
    vi.spyOn(storageService, 'assembleChunks').mockImplementation((uploadId, total, key) =>
      localStorage.assembleChunks(uploadId, total, key)
    );
    vi.spyOn(storageService, 'delete').mockImplementation((key) =>
      localStorage.delete(key)
    );
    vi.spyOn(storageService, 'exists').mockImplementation((key) =>
      localStorage.exists(key)
    );
    vi.spyOn(storageService, 'download').mockImplementation((key) =>
      localStorage.download(key)
    );

    // Mock User.findById for auth middleware and storage checks
    vi.spyOn(User, 'findById').mockImplementation((id: any) => {
      const idStr = id?.toString();
      if (idStr === userAId) {
        return Promise.resolve({
          _id: new mongoose.Types.ObjectId(userAId),
          name: 'User A',
          email: 'usera@example.com',
          isActive: true,
          storageQuota: 10 * 1024 * 1024 * 1024,
          storageUsed: 1024 * 1024,
        } as any);
      }
      if (idStr === userBId) {
        return Promise.resolve({
          _id: new mongoose.Types.ObjectId(userBId),
          name: 'User B',
          email: 'userb@example.com',
          isActive: true,
          storageQuota: 10 * 1024 * 1024 * 1024,
          storageUsed: 500 * 1024,
        } as any);
      }
      return Promise.resolve(null);
    });

    vi.spyOn(User, 'findByIdAndUpdate').mockResolvedValue({} as any);
    vi.spyOn(File, 'findOne').mockResolvedValue(null);
  });

  describe('1. POST /api/v1/uploads/init (Session Initialization)', () => {
    it('initializes a chunked upload session with valid parameters', async () => {
      vi.spyOn(File, 'findOne').mockResolvedValue(null);

      const fakeSessionId = new mongoose.Types.ObjectId();
      const fakeSession = {
        _id: fakeSessionId,
        userId: new mongoose.Types.ObjectId(userAId),
        fileName: 'large-video.mp4',
        totalSize: 15 * 1024 * 1024, // 15 MB
        chunkSize: 5 * 1024 * 1024, // 5 MB
        totalChunks: 3,
        uploadedChunks: [],
        storageKey: 'objects/ab/1234567890abcdef',
        status: 'PENDING',
        expiresAt: new Date(Date.now() + 24 * 3600 * 1000),
      };

      vi.spyOn(UploadSession, 'create').mockResolvedValue(fakeSession as any);

      const res = await request(app)
        .post('/api/v1/uploads/init')
        .set('Authorization', `Bearer ${tokenUserA}`)
        .send({
          fileName: 'large-video.mp4',
          totalSize: 15 * 1024 * 1024,
          chunkSize: 5 * 1024 * 1024,
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.session.fileName).toBe('large-video.mp4');
      expect(res.body.data.session.totalChunks).toBe(3);
      expect(res.body.data.session.status).toBe('PENDING');
    });

    it('rejects unauthenticated initialization (401 UNAUTHORIZED)', async () => {
      const res = await request(app)
        .post('/api/v1/uploads/init')
        .send({
          fileName: 'file.txt',
          totalSize: 1000,
        });

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('UNAUTHORIZED');
    });

    it('rejects initialization with invalid filename (400)', async () => {
      const res = await request(app)
        .post('/api/v1/uploads/init')
        .set('Authorization', `Bearer ${tokenUserA}`)
        .send({
          fileName: 'invalid/file/name.txt',
          totalSize: 1000,
        });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('rejects initialization when user quota is exceeded (400 STORAGE_QUOTA_EXCEEDED)', async () => {
      vi.spyOn(User, 'findById').mockResolvedValue({
        _id: new mongoose.Types.ObjectId(userAId),
        isActive: true,
        storageQuota: 1000,
        storageUsed: 950,
      } as any);

      const res = await request(app)
        .post('/api/v1/uploads/init')
        .set('Authorization', `Bearer ${tokenUserA}`)
        .send({
          fileName: 'overflow.dat',
          totalSize: 500, // 950 + 500 > 1000
        });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('STORAGE_QUOTA_EXCEEDED');
    });

    it('rejects initialization in another user folder (401 FORBIDDEN)', async () => {
      const folderId = new mongoose.Types.ObjectId();
      vi.spyOn(Folder, 'findById').mockResolvedValue({
        _id: folderId,
        ownerId: new mongoose.Types.ObjectId(userBId), // User B's folder
        isDeleted: false,
      } as any);

      const res = await request(app)
        .post('/api/v1/uploads/init')
        .set('Authorization', `Bearer ${tokenUserA}`)
        .send({
          fileName: 'doc.pdf',
          totalSize: 1000,
          folderId: folderId.toString(),
        });

      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });

    it('rejects initialization if file already exists in destination folder (409 Conflict)', async () => {
      vi.spyOn(File, 'findOne').mockResolvedValue({
        _id: new mongoose.Types.ObjectId(),
        name: 'existing.pdf',
      } as any);

      const res = await request(app)
        .post('/api/v1/uploads/init')
        .set('Authorization', `Bearer ${tokenUserA}`)
        .send({
          fileName: 'existing.pdf',
          totalSize: 5000,
        });

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('FILE_ALREADY_EXISTS');
    });
  });

  describe('2. PUT /api/v1/uploads/:uploadId/chunks/:chunkNumber (Chunk Ingestion & Validation)', () => {
    it('accepts valid chunk upload and updates session progress', async () => {
      const uploadId = new mongoose.Types.ObjectId();
      const chunkData = Buffer.alloc(1024, 'A');

      const mockSession = {
        _id: uploadId,
        userId: new mongoose.Types.ObjectId(userAId),
        totalSize: 2048,
        chunkSize: 1024,
        totalChunks: 2,
        uploadedChunks: [] as any[],
        status: 'PENDING',
        expiresAt: new Date(Date.now() + 100000),
        save: vi.fn().mockResolvedValue(true),
      };

      vi.spyOn(UploadSession, 'findById').mockResolvedValue(mockSession as any);

      const res = await request(app)
        .put(`/api/v1/uploads/${uploadId.toString()}/chunks/0`)
        .set('Authorization', `Bearer ${tokenUserA}`)
        .attach('chunk', chunkData, 'chunk_0.bin');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.chunkNumber).toBe(0);
      expect(res.body.data.size).toBe(1024);
      expect(res.body.data.isDuplicate).toBe(false);
      expect(mockSession.uploadedChunks.length).toBe(1);
      expect(mockSession.status).toBe('UPLOADING');
      expect(mockSession.save).toHaveBeenCalled();
    });

    it('rejects User B uploading to User A session (401 FORBIDDEN)', async () => {
      const uploadId = new mongoose.Types.ObjectId();
      const mockSession = {
        _id: uploadId,
        userId: new mongoose.Types.ObjectId(userAId), // User A's session
        status: 'PENDING',
        expiresAt: new Date(Date.now() + 100000),
      };

      vi.spyOn(UploadSession, 'findById').mockResolvedValue(mockSession as any);

      const res = await request(app)
        .put(`/api/v1/uploads/${uploadId.toString()}/chunks/0`)
        .set('Authorization', `Bearer ${tokenUserB}`) // User B
        .attach('chunk', Buffer.from('data'), 'chunk_0.bin');

      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });

    it('rejects chunk number out of bounds (400 INVALID_CHUNK_NUMBER)', async () => {
      const uploadId = new mongoose.Types.ObjectId();
      const mockSession = {
        _id: uploadId,
        userId: new mongoose.Types.ObjectId(userAId),
        totalSize: 2000,
        chunkSize: 1000,
        totalChunks: 2,
        status: 'PENDING',
        expiresAt: new Date(Date.now() + 100000),
      };

      vi.spyOn(UploadSession, 'findById').mockResolvedValue(mockSession as any);

      const res = await request(app)
        .put(`/api/v1/uploads/${uploadId.toString()}/chunks/5`) // Chunk 5 > totalChunks 2
        .set('Authorization', `Bearer ${tokenUserA}`)
        .attach('chunk', Buffer.from('data'), 'chunk_5.bin');

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('INVALID_CHUNK_NUMBER');
    });

    it('rejects chunk when received size does not match expected chunk size (400 INVALID_CHUNK_SIZE)', async () => {
      const uploadId = new mongoose.Types.ObjectId();
      const mockSession = {
        _id: uploadId,
        userId: new mongoose.Types.ObjectId(userAId),
        totalSize: 3000,
        chunkSize: 1000,
        totalChunks: 3,
        uploadedChunks: [] as any[],
        status: 'PENDING',
        expiresAt: new Date(Date.now() + 100000),
      };

      vi.spyOn(UploadSession, 'findById').mockResolvedValue(mockSession as any);

      // Send 500 bytes when chunk 0 expected 1000 bytes
      const badChunk = Buffer.alloc(500, 'B');

      const res = await request(app)
        .put(`/api/v1/uploads/${uploadId.toString()}/chunks/0`)
        .set('Authorization', `Bearer ${tokenUserA}`)
        .attach('chunk', badChunk, 'chunk_0.bin');

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('INVALID_CHUNK_SIZE');
    });

    it('handles identical duplicate chunk idempotently (returns 200 isDuplicate: true)', async () => {
      const uploadId = new mongoose.Types.ObjectId();
      const chunkData = Buffer.alloc(1000, 'Z');

      // Upload chunk first time to calculate exact checksum
      const mockSession = {
        _id: uploadId,
        userId: new mongoose.Types.ObjectId(userAId),
        totalSize: 1000,
        chunkSize: 1000,
        totalChunks: 1,
        uploadedChunks: [] as any[],
        status: 'PENDING',
        expiresAt: new Date(Date.now() + 100000),
        save: vi.fn().mockResolvedValue(true),
      };

      vi.spyOn(UploadSession, 'findById').mockResolvedValue(mockSession as any);

      const firstRes = await request(app)
        .put(`/api/v1/uploads/${uploadId.toString()}/chunks/0`)
        .set('Authorization', `Bearer ${tokenUserA}`)
        .attach('chunk', chunkData, 'chunk_0.bin');

      expect(firstRes.status).toBe(200);
      expect(firstRes.body.data.isDuplicate).toBe(false);

      // Second identical upload with same content
      const secondRes = await request(app)
        .put(`/api/v1/uploads/${uploadId.toString()}/chunks/0`)
        .set('Authorization', `Bearer ${tokenUserA}`)
        .attach('chunk', chunkData, 'chunk_0.bin');

      expect(secondRes.status).toBe(200);
      expect(secondRes.body.data.isDuplicate).toBe(true);
    });

    it('rejects conflicting duplicate chunk with different checksum (409 Conflict)', async () => {
      const uploadId = new mongoose.Types.ObjectId();
      const mockSession = {
        _id: uploadId,
        userId: new mongoose.Types.ObjectId(userAId),
        totalSize: 1000,
        chunkSize: 1000,
        totalChunks: 1,
        uploadedChunks: [
          {
            chunkNumber: 0,
            size: 1000,
            checksum: 'original_checksum_12345',
            uploadedAt: new Date(),
          },
        ],
        status: 'UPLOADING',
        expiresAt: new Date(Date.now() + 100000),
        save: vi.fn(),
      };

      vi.spyOn(UploadSession, 'findById').mockResolvedValue(mockSession as any);

      // Upload different content for chunk 0
      const conflictingChunk = Buffer.alloc(1000, 'X');

      const res = await request(app)
        .put(`/api/v1/uploads/${uploadId.toString()}/chunks/0`)
        .set('Authorization', `Bearer ${tokenUserA}`)
        .attach('chunk', conflictingChunk, 'chunk_0.bin');

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('DUPLICATE_CHUNK_CONFLICT');
    });

    it('rejects chunk upload on expired session (400 SESSION_EXPIRED)', async () => {
      const uploadId = new mongoose.Types.ObjectId();
      const mockSession = {
        _id: uploadId,
        userId: new mongoose.Types.ObjectId(userAId),
        totalSize: 1000,
        chunkSize: 1000,
        totalChunks: 1,
        status: 'PENDING',
        expiresAt: new Date(Date.now() - 1000), // In the past!
        save: vi.fn().mockResolvedValue(true),
      };

      vi.spyOn(UploadSession, 'findById').mockResolvedValue(mockSession as any);

      const res = await request(app)
        .put(`/api/v1/uploads/${uploadId.toString()}/chunks/0`)
        .set('Authorization', `Bearer ${tokenUserA}`)
        .attach('chunk', Buffer.alloc(1000), 'chunk_0.bin');

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('SESSION_EXPIRED');
    });
  });

  describe('3. POST /api/v1/uploads/:uploadId/complete (Assembly & Finalization)', () => {
    it('rejects completion when any chunk is missing (400 MISSING_CHUNKS)', async () => {
      const uploadId = new mongoose.Types.ObjectId();
      const mockSession = {
        _id: uploadId,
        userId: new mongoose.Types.ObjectId(userAId),
        totalSize: 3000,
        chunkSize: 1000,
        totalChunks: 3,
        uploadedChunks: [
          { chunkNumber: 0, size: 1000, checksum: 'c0' },
          // Chunk 1 is MISSING!
          { chunkNumber: 2, size: 1000, checksum: 'c2' },
        ],
        status: 'UPLOADING',
        expiresAt: new Date(Date.now() + 100000),
      };

      vi.spyOn(UploadSession, 'findById').mockResolvedValue(mockSession as any);
      vi.spyOn(UploadSession, 'findOneAndUpdate').mockResolvedValue(mockSession as any);
      vi.spyOn(UploadSession, 'findByIdAndUpdate').mockResolvedValue({} as any);

      const res = await request(app)
        .post(`/api/v1/uploads/${uploadId.toString()}/complete`)
        .set('Authorization', `Bearer ${tokenUserA}`);

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('MISSING_CHUNKS');
      expect(res.body.error.message).toContain('1');
    });

    it('assembles out-of-order chunks into an exact byte-for-byte final file', async () => {
      const uploadId = new mongoose.Types.ObjectId();
      const chunk0 = Buffer.from('CHUNK_0000'); // 10 bytes
      const chunk1 = Buffer.from('CHUNK_1111'); // 10 bytes
      const chunk2 = Buffer.from('CHUNK_22'); // 8 bytes
      const fullExpectedContent = 'CHUNK_0000CHUNK_1111CHUNK_22';

      const totalSize = 28;
      const chunkSize = 10;

      const mockSession: any = {
        _id: uploadId,
        userId: new mongoose.Types.ObjectId(userAId),
        fileName: 'assembled-test.txt',
        folderId: null,
        mimeType: 'text/plain',
        totalSize,
        chunkSize,
        totalChunks: 3,
        uploadedChunks: [],
        storageKey: `objects/te/assembled-${Date.now()}`,
        status: 'PENDING',
        expiresAt: new Date(Date.now() + 100000),
        save: vi.fn().mockResolvedValue(true),
      };

      vi.spyOn(UploadSession, 'findById').mockImplementation(async () => mockSession);
      vi.spyOn(UploadSession, 'findOneAndUpdate').mockImplementation(async () => mockSession);
      vi.spyOn(UploadSession, 'findByIdAndUpdate').mockResolvedValue({} as any);

      const fakeCreatedFile = {
        _id: new mongoose.Types.ObjectId(),
        name: 'assembled-test.txt',
        ownerId: new mongoose.Types.ObjectId(userAId),
        folderId: null,
        storageKey: mockSession.storageKey,
        size: totalSize,
        mimeType: 'text/plain',
        checksum: 'assembled_sha256',
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      vi.spyOn(File, 'create').mockResolvedValue(fakeCreatedFile as any);

      // Upload chunk 2 first (out of order!)
      await request(app)
        .put(`/api/v1/uploads/${uploadId.toString()}/chunks/2`)
        .set('Authorization', `Bearer ${tokenUserA}`)
        .attach('chunk', chunk2, 'chunk_2.bin');

      // Upload chunk 0
      await request(app)
        .put(`/api/v1/uploads/${uploadId.toString()}/chunks/0`)
        .set('Authorization', `Bearer ${tokenUserA}`)
        .attach('chunk', chunk0, 'chunk_0.bin');

      // Upload chunk 1
      await request(app)
        .put(`/api/v1/uploads/${uploadId.toString()}/chunks/1`)
        .set('Authorization', `Bearer ${tokenUserA}`)
        .attach('chunk', chunk1, 'chunk_1.bin');

      expect(mockSession.uploadedChunks.length).toBe(3);

      // Now complete the upload
      const res = await request(app)
        .post(`/api/v1/uploads/${uploadId.toString()}/complete`)
        .set('Authorization', `Bearer ${tokenUserA}`);

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.file.name).toBe('assembled-test.txt');

      // Verify assembled file content on disk byte-for-byte
      const fileBytes = await localStorage.download(mockSession.storageKey);
      expect(fileBytes.toString()).toBe(fullExpectedContent);

      // Clean up assembled file
      await localStorage.delete(mockSession.storageKey);
    });

    it('returns existing file idempotently on repeated completion (avoids duplicates)', async () => {
      const uploadId = new mongoose.Types.ObjectId();
      const mockSession = {
        _id: uploadId,
        userId: new mongoose.Types.ObjectId(userAId),
        storageKey: 'objects/dup/key123',
        status: 'COMPLETED',
        expiresAt: new Date(Date.now() + 100000),
      };

      const existingFile = {
        _id: new mongoose.Types.ObjectId(),
        name: 'already-finished.txt',
        storageKey: 'objects/dup/key123',
      };

      vi.spyOn(UploadSession, 'findById').mockResolvedValue(mockSession as any);
      vi.spyOn(File, 'findOne').mockResolvedValue(existingFile as any);

      const res = await request(app)
        .post(`/api/v1/uploads/${uploadId.toString()}/complete`)
        .set('Authorization', `Bearer ${tokenUserA}`);

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.file.name).toBe('already-finished.txt');
    });

    it('rejects User B completing User A session (401 FORBIDDEN)', async () => {
      const uploadId = new mongoose.Types.ObjectId();
      const mockSession = {
        _id: uploadId,
        userId: new mongoose.Types.ObjectId(userAId),
        status: 'UPLOADING',
        expiresAt: new Date(Date.now() + 100000),
      };

      vi.spyOn(UploadSession, 'findById').mockResolvedValue(mockSession as any);

      const res = await request(app)
        .post(`/api/v1/uploads/${uploadId.toString()}/complete`)
        .set('Authorization', `Bearer ${tokenUserB}`);

      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });
  });

  describe('4. DELETE /api/v1/uploads/:uploadId (Session Cancellation)', () => {
    it('cancels session and cleans up temporary chunks', async () => {
      const uploadId = new mongoose.Types.ObjectId();
      const mockSession = {
        _id: uploadId,
        userId: new mongoose.Types.ObjectId(userAId),
        status: 'UPLOADING',
        save: vi.fn().mockResolvedValue(true),
      };

      vi.spyOn(UploadSession, 'findById').mockResolvedValue(mockSession as any);
      const deleteChunksSpy = vi.spyOn(storageService, 'deleteChunks');

      const res = await request(app)
        .delete(`/api/v1/uploads/${uploadId.toString()}`)
        .set('Authorization', `Bearer ${tokenUserA}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(mockSession.status).toBe('CANCELLED');
      expect(deleteChunksSpy).toHaveBeenCalledWith(uploadId.toString());
    });
  });
});

