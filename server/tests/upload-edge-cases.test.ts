import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import mongoose from 'mongoose';
import fs from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import { Readable } from 'stream';
import { createApp } from '../src/app.js';
import { UploadSession } from '../src/models/UploadSession.js';
import { File } from '../src/models/File.js';
import { User } from '../src/models/User.js';
import { signAccessToken } from '../src/utils/jwt.js';
import { cacheService } from '../src/services/cache.service.js';
import { LocalStorageService } from '../src/services/storage/local-storage.service.js';
import { setStorageService } from '../src/services/storage/index.js';

describe('Phase 14 — Upload Edge Cases Test Suite', () => {
  let app: ReturnType<typeof createApp>;
  let tempBaseDir: string;
  let localStorageService: LocalStorageService;

  const userAId = new mongoose.Types.ObjectId().toString();
  const userBId = new mongoose.Types.ObjectId().toString();

  const tokenUserA = signAccessToken({ userId: userAId, email: 'usera@example.com', role: 'user' });
  const tokenUserB = signAccessToken({ userId: userBId, email: 'userb@example.com', role: 'user' });

  const mockUserA = {
    _id: new mongoose.Types.ObjectId(userAId),
    name: 'User A',
    email: 'usera@example.com',
    storageQuota: 10 * 1024 * 1024 * 1024,
    storageUsed: 0,
    storageReserved: 0,
    isActive: true,
  };

  const mockUserB = {
    _id: new mongoose.Types.ObjectId(userBId),
    name: 'User B',
    email: 'userb@example.com',
    storageQuota: 10 * 1024 * 1024 * 1024,
    storageUsed: 0,
    storageReserved: 0,
    isActive: true,
  };

  beforeEach(() => {
    vi.restoreAllMocks();

    tempBaseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'edge-case-base-'));
    localStorageService = new LocalStorageService(tempBaseDir);
    setStorageService(localStorageService);

    app = createApp();

    vi.spyOn(cacheService, 'get').mockResolvedValue(null);
    vi.spyOn(cacheService, 'set').mockResolvedValue(undefined);
    vi.spyOn(cacheService, 'del').mockResolvedValue(undefined);
    vi.spyOn(cacheService, 'delByPattern').mockResolvedValue(undefined);

    vi.spyOn(User, 'findById').mockImplementation(async (id: any) => {
      const idStr = id.toString();
      if (idStr === userAId) return mockUserA as any;
      if (idStr === userBId) return mockUserB as any;
      return null;
    });
    vi.spyOn(User, 'findOneAndUpdate').mockResolvedValue(mockUserA as any);
    vi.spyOn(User, 'findByIdAndUpdate').mockResolvedValue(mockUserA as any);
    vi.spyOn(File, 'findOne').mockResolvedValue(null);
  });

  afterEach(() => {
    try {
      fs.rmSync(tempBaseDir, { recursive: true, force: true });
    } catch {
      // Ignore
    }
  });

  describe('Case A: Missing Chunk', () => {
    it('rejects upload completion when a required chunk has not been uploaded', async () => {
      const uploadId = new mongoose.Types.ObjectId();
      const chunk0Data = Buffer.alloc(256 * 1024, 'a');
      const chunk2Data = Buffer.alloc(256 * 1024, 'c');

      // Stage chunk 0 and chunk 2 physically, leaving chunk 1 missing
      await localStorageService.saveChunk(uploadId.toString(), 0, Readable.from(chunk0Data));
      await localStorageService.saveChunk(uploadId.toString(), 2, Readable.from(chunk2Data));

      const mockSession = {
        _id: uploadId,
        userId: new mongoose.Types.ObjectId(userAId),
        fileName: 'missing-chunk-test.bin',
        totalSize: 3 * 256 * 1024,
        chunkSize: 256 * 1024,
        totalChunks: 3,
        status: 'UPLOADING',
        uploadedChunks: [
          { chunkNumber: 0, size: 256 * 1024, checksum: 'sha-0' },
          { chunkNumber: 2, size: 256 * 1024, checksum: 'sha-2' },
          // Chunk 1 is missing!
        ],
        storageKey: 'objects/aa/missing-test',
        expiresAt: new Date(Date.now() + 86400000),
      };

      vi.spyOn(UploadSession, 'findById').mockResolvedValue(mockSession as any);
      vi.spyOn(UploadSession, 'findOneAndUpdate').mockResolvedValue(mockSession as any);
      vi.spyOn(UploadSession, 'findByIdAndUpdate').mockResolvedValue(mockSession as any);

      const res = await request(app)
        .post(`/api/v1/uploads/${uploadId.toString()}/complete`)
        .set('Authorization', `Bearer ${tokenUserA}`)
        .send({});

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('MISSING_CHUNKS');
      expect(res.body.error.message).toContain('missing chunks: [1]');
    });
  });

  describe('Case B: Duplicate Chunk Handling', () => {
    it('acknowledges identical duplicate chunks idempotently (200 OK)', async () => {
      const uploadId = new mongoose.Types.ObjectId();
      const chunkData = Buffer.from('Duplicate chunk payload 256kb test');
      const hash = crypto.createHash('sha256').update(chunkData).digest('hex');

      // Stage chunk physically using storage service
      await localStorageService.saveChunk(uploadId.toString(), 0, Readable.from(chunkData));

      const mockSession = {
        _id: uploadId,
        userId: new mongoose.Types.ObjectId(userAId),
        fileName: 'dup-test.bin',
        totalSize: chunkData.length * 2,
        chunkSize: chunkData.length,
        totalChunks: 2,
        status: 'UPLOADING',
        uploadedChunks: [{ chunkNumber: 0, size: chunkData.length, checksum: hash }],
        expiresAt: new Date(Date.now() + 86400000),
        save: vi.fn().mockResolvedValue(true),
      };

      vi.spyOn(UploadSession, 'findById').mockResolvedValue(mockSession as any);

      const res = await request(app)
        .put(`/api/v1/uploads/${uploadId.toString()}/chunks/0`)
        .set('Authorization', `Bearer ${tokenUserA}`)
        .set('Content-Type', 'application/octet-stream')
        .send(chunkData);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.isDuplicate).toBe(true);
    });

    it('rejects duplicate chunk with conflicting checksum (409 Conflict)', async () => {
      const uploadId = new mongoose.Types.ObjectId();
      const originalData = Buffer.from('Original valid chunk content');
      const originalHash = crypto.createHash('sha256').update(originalData).digest('hex');

      // Stage original chunk physically
      await localStorageService.saveChunk(uploadId.toString(), 0, Readable.from(originalData));

      const mockSession = {
        _id: uploadId,
        userId: new mongoose.Types.ObjectId(userAId),
        fileName: 'dup-conflict.bin',
        totalSize: originalData.length * 2,
        chunkSize: originalData.length,
        totalChunks: 2,
        status: 'UPLOADING',
        uploadedChunks: [{ chunkNumber: 0, size: originalData.length, checksum: originalHash }],
        expiresAt: new Date(Date.now() + 86400000),
        save: vi.fn().mockResolvedValue(true),
      };

      vi.spyOn(UploadSession, 'findById').mockResolvedValue(mockSession as any);

      const conflictingData = Buffer.from('Conflicting different content');
      const res = await request(app)
        .put(`/api/v1/uploads/${uploadId.toString()}/chunks/0`)
        .set('Authorization', `Bearer ${tokenUserA}`)
        .set('Content-Type', 'application/octet-stream')
        .send(conflictingData);

      expect(res.status).toBe(409);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('DUPLICATE_CHUNK_CONFLICT');
    });
  });

  describe('Case C: Out-of-Order Chunk Ingestion', () => {
    it('accepts chunks received out-of-order and assembles them in numerical order', async () => {
      const uploadId = new mongoose.Types.ObjectId();
      const chunk0 = Buffer.from('Part 0: Header | ');
      const chunk1 = Buffer.from('Part 1: Body | ');
      const chunk2 = Buffer.from('Part 2: Footer');

      const totalSize = chunk0.length + chunk1.length + chunk2.length;

      // Stage physically out of order: chunk 2, then 0, then 1
      await localStorageService.saveChunk(uploadId.toString(), 2, Readable.from(chunk2));
      await localStorageService.saveChunk(uploadId.toString(), 0, Readable.from(chunk0));
      await localStorageService.saveChunk(uploadId.toString(), 1, Readable.from(chunk1));

      const targetKey = 'objects/cc/out-of-order-assembled.bin';
      const assembled = await localStorageService.assembleChunks(uploadId.toString(), 3, targetKey);

      expect(assembled.size).toBe(totalSize);

      const fullContent = await localStorageService.download(targetKey);
      expect(fullContent.toString('utf-8')).toBe('Part 0: Header | Part 1: Body | Part 2: Footer');
    });
  });

  describe('Case D: Interrupted Upload Recovery', () => {
    it('maintains session in UPLOADING state with missing chunks calculated after disconnect', async () => {
      const uploadId = new mongoose.Types.ObjectId();
      const chunk0Data = Buffer.from('Chunk 0 data');

      await localStorageService.saveChunk(uploadId.toString(), 0, Readable.from(chunk0Data));

      const mockSession = {
        _id: uploadId,
        userId: new mongoose.Types.ObjectId(userAId),
        fileName: 'interrupted.bin',
        totalSize: 3 * chunk0Data.length,
        chunkSize: chunk0Data.length,
        totalChunks: 3,
        status: 'UPLOADING',
        uploadedChunks: [{ chunkNumber: 0, size: chunk0Data.length, checksum: 'sha-0' }],
        expiresAt: new Date(Date.now() + 86400000),
        save: vi.fn().mockResolvedValue(true),
      };

      vi.spyOn(UploadSession, 'findById').mockResolvedValue(mockSession as any);

      // Client queries status to resume
      const res = await request(app)
        .get(`/api/v1/uploads/${uploadId.toString()}/status`)
        .set('Authorization', `Bearer ${tokenUserA}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.status).toBe('UPLOADING');
      expect(res.body.data.uploadedChunks).toEqual([0]);
      expect(res.body.data.missingChunks).toEqual([1, 2]);
      expect(res.body.data.canAcceptChunks).toBe(true);
    });
  });

  describe('Case E: Expired Upload Session', () => {
    it('rejects chunk ingestion for expired upload sessions', async () => {
      const uploadId = new mongoose.Types.ObjectId();
      const mockSession = {
        _id: uploadId,
        userId: new mongoose.Types.ObjectId(userAId),
        fileName: 'expired.bin',
        totalSize: 1024,
        chunkSize: 512,
        totalChunks: 2,
        status: 'UPLOADING',
        uploadedChunks: [],
        expiresAt: new Date(Date.now() - 3600000), // 1 hour ago
        save: vi.fn().mockResolvedValue(true),
      };

      vi.spyOn(UploadSession, 'findById').mockResolvedValue(mockSession as any);

      const res = await request(app)
        .put(`/api/v1/uploads/${uploadId.toString()}/chunks/0`)
        .set('Authorization', `Bearer ${tokenUserA}`)
        .set('Content-Type', 'application/octet-stream')
        .send(Buffer.from('late chunk'));

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('SESSION_EXPIRED');
    });

    it('rejects completion for expired upload sessions', async () => {
      const uploadId = new mongoose.Types.ObjectId();
      const mockSession = {
        _id: uploadId,
        userId: new mongoose.Types.ObjectId(userAId),
        fileName: 'expired.bin',
        totalSize: 1024,
        chunkSize: 512,
        totalChunks: 2,
        status: 'UPLOADING',
        uploadedChunks: [],
        expiresAt: new Date(Date.now() - 3600000), // 1 hour ago
        save: vi.fn().mockResolvedValue(true),
      };

      vi.spyOn(UploadSession, 'findById').mockResolvedValue(mockSession as any);

      const res = await request(app)
        .post(`/api/v1/uploads/${uploadId.toString()}/complete`)
        .set('Authorization', `Bearer ${tokenUserA}`)
        .send({});

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('SESSION_EXPIRED');
    });
  });

  describe('Case F: Checksum Mismatch', () => {
    it('rejects chunk when provided client checksum does not match computed checksum', async () => {
      const uploadId = new mongoose.Types.ObjectId();
      const chunkData = Buffer.from('Testing checksum mismatch payload');
      const mockSession = {
        _id: uploadId,
        userId: new mongoose.Types.ObjectId(userAId),
        fileName: 'checksum-test.bin',
        totalSize: chunkData.length * 2,
        chunkSize: chunkData.length,
        totalChunks: 2,
        status: 'PENDING',
        uploadedChunks: [],
        expiresAt: new Date(Date.now() + 86400000),
        save: vi.fn().mockResolvedValue(true),
      };

      vi.spyOn(UploadSession, 'findById').mockResolvedValue(mockSession as any);

      const bogusChecksum = '0000000000000000000000000000000000000000000000000000000000000000';

      const res = await request(app)
        .put(`/api/v1/uploads/${uploadId.toString()}/chunks/0?checksum=${bogusChecksum}`)
        .set('Authorization', `Bearer ${tokenUserA}`)
        .set('Content-Type', 'application/octet-stream')
        .send(chunkData);

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('CHECKSUM_MISMATCH');
    });

    it('rejects completion when client file checksum does not match assembled file checksum', async () => {
      const uploadId = new mongoose.Types.ObjectId();
      const chunkData = Buffer.from('Assembled file content');

      await localStorageService.saveChunk(uploadId.toString(), 0, Readable.from(chunkData));

      const mockSession = {
        _id: uploadId,
        userId: new mongoose.Types.ObjectId(userAId),
        fileName: 'complete-checksum-test.bin',
        totalSize: chunkData.length,
        chunkSize: chunkData.length,
        totalChunks: 1,
        status: 'UPLOADING',
        uploadedChunks: [{ chunkNumber: 0, size: chunkData.length, checksum: 'sha-0' }],
        storageKey: 'objects/ff/checksum-test',
        reservedBytes: chunkData.length,
        expiresAt: new Date(Date.now() + 86400000),
      };

      vi.spyOn(UploadSession, 'findById').mockResolvedValue(mockSession as any);
      vi.spyOn(UploadSession, 'findOneAndUpdate').mockResolvedValue(mockSession as any);
      vi.spyOn(UploadSession, 'findByIdAndUpdate').mockResolvedValue(mockSession as any);

      const bogusFileChecksum = 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef';

      const res = await request(app)
        .post(`/api/v1/uploads/${uploadId.toString()}/complete`)
        .set('Authorization', `Bearer ${tokenUserA}`)
        .send({ checksum: bogusFileChecksum });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('CHECKSUM_MISMATCH');
    });
  });

  describe('Case G: Unauthorized Cross-User Upload Access', () => {
    it('rejects User B attempting to view User A upload status (401 FORBIDDEN)', async () => {
      const uploadId = new mongoose.Types.ObjectId();
      const sessionUserA = {
        _id: uploadId,
        userId: new mongoose.Types.ObjectId(userAId),
        status: 'UPLOADING',
        expiresAt: new Date(Date.now() + 86400000),
      };

      vi.spyOn(UploadSession, 'findById').mockResolvedValue(sessionUserA as any);

      const res = await request(app)
        .get(`/api/v1/uploads/${uploadId.toString()}/status`)
        .set('Authorization', `Bearer ${tokenUserB}`);

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });

    it('rejects User B attempting to upload chunks to User A upload session (401 FORBIDDEN)', async () => {
      const uploadId = new mongoose.Types.ObjectId();
      const sessionUserA = {
        _id: uploadId,
        userId: new mongoose.Types.ObjectId(userAId),
        status: 'UPLOADING',
        expiresAt: new Date(Date.now() + 86400000),
      };

      vi.spyOn(UploadSession, 'findById').mockResolvedValue(sessionUserA as any);

      const res = await request(app)
        .put(`/api/v1/uploads/${uploadId.toString()}/chunks/0`)
        .set('Authorization', `Bearer ${tokenUserB}`)
        .set('Content-Type', 'application/octet-stream')
        .send(Buffer.from('attacker chunk data'));

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });

    it('rejects User B attempting to complete User A upload session (401 FORBIDDEN)', async () => {
      const uploadId = new mongoose.Types.ObjectId();
      const sessionUserA = {
        _id: uploadId,
        userId: new mongoose.Types.ObjectId(userAId),
        status: 'UPLOADING',
        expiresAt: new Date(Date.now() + 86400000),
      };

      vi.spyOn(UploadSession, 'findById').mockResolvedValue(sessionUserA as any);

      const res = await request(app)
        .post(`/api/v1/uploads/${uploadId.toString()}/complete`)
        .set('Authorization', `Bearer ${tokenUserB}`)
        .send({});

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });

    it('rejects User B attempting to cancel User A upload session (401 FORBIDDEN)', async () => {
      const uploadId = new mongoose.Types.ObjectId();
      const sessionUserA = {
        _id: uploadId,
        userId: new mongoose.Types.ObjectId(userAId),
        status: 'UPLOADING',
        expiresAt: new Date(Date.now() + 86400000),
      };

      vi.spyOn(UploadSession, 'findById').mockResolvedValue(sessionUserA as any);

      const res = await request(app)
        .delete(`/api/v1/uploads/${uploadId.toString()}`)
        .set('Authorization', `Bearer ${tokenUserB}`);

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });
  });
});
