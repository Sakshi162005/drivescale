import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import request from 'supertest';
import mongoose from 'mongoose';
import path from 'path';
import fs from 'fs';
import os from 'os';
import crypto from 'crypto';
import { createApp } from '../src/app.js';
import { UploadSession } from '../src/models/UploadSession.js';
import { File } from '../src/models/File.js';
import { User } from '../src/models/User.js';
import { signAccessToken } from '../src/utils/jwt.js';
import { LocalStorageService } from '../src/services/storage/local-storage.service.js';
import { storageService } from '../src/services/storage/index.js';
import { MIN_CHUNK_SIZE } from '../src/schemas/upload.schema.js';

describe('Phase 5 Resumable Uploads Test Suite', () => {
  const app = createApp();

  const userAId = new mongoose.Types.ObjectId().toString();
  const userBId = new mongoose.Types.ObjectId().toString();

  const tokenUserA = signAccessToken({ userId: userAId, email: 'resumable-a@example.com', role: 'user' });
  const tokenUserB = signAccessToken({ userId: userBId, email: 'resumable-b@example.com', role: 'user' });

  const testStorageDir = path.join(os.tmpdir(), `drivescale-resume-test-${Date.now()}`);
  const localStorage = new LocalStorageService(testStorageDir);

  const sessionStore = new Map<string, any>();
  const fileStore = new Map<string, any>();

  afterAll(async () => {
    try {
      await fs.promises.rm(testStorageDir, { recursive: true, force: true });
    } catch {
      // Ignore
    }
  });

  beforeEach(() => {
    vi.restoreAllMocks();
    sessionStore.clear();
    fileStore.clear();

    // Route storageService calls to test LocalStorageService
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
          email: 'resumable-a@example.com',
          role: 'user',
          isActive: true,
          storageQuota: 10 * 1024 * 1024 * 1024,
          storageUsed: 1024 * 1024,
        } as any);
      }
      if (idStr === userBId) {
        return Promise.resolve({
          _id: new mongoose.Types.ObjectId(userBId),
          name: 'User B',
          email: 'resumable-b@example.com',
          role: 'user',
          isActive: true,
          storageQuota: 10 * 1024 * 1024 * 1024,
          storageUsed: 500 * 1024,
        } as any);
      }
      return Promise.resolve(null);
    });

    vi.spyOn(User, 'findByIdAndUpdate').mockResolvedValue({} as any);

    // Mock UploadSession model methods with in-memory persistence
    vi.spyOn(UploadSession, 'create').mockImplementation((data: any) => {
      const session = {
        ...data,
        _id: data._id || new mongoose.Types.ObjectId(),
        uploadedChunks: data.uploadedChunks || [],
        status: data.status || 'PENDING',
        expiresAt: data.expiresAt || new Date(Date.now() + 24 * 3600 * 1000),
        save: vi.fn().mockImplementation(function (this: any) {
          sessionStore.set(this._id.toString(), this);
          return Promise.resolve(this);
        }),
      };
      sessionStore.set(session._id.toString(), session);
      return Promise.resolve(session as any);
    });

    vi.spyOn(UploadSession, 'findById').mockImplementation((id: any) => {
      const s = sessionStore.get(id?.toString());
      return Promise.resolve(s || null);
    });

    vi.spyOn(UploadSession, 'findByIdAndUpdate').mockImplementation((id: any, update: any) => {
      const s = sessionStore.get(id?.toString());
      if (!s) return Promise.resolve(null);
      if (update.$set) {
        Object.assign(s, update.$set);
      }
      return Promise.resolve(s);
    });

    vi.spyOn(UploadSession, 'findOneAndUpdate').mockImplementation((filter: any, update: any) => {
      const s = sessionStore.get(filter._id?.toString());
      if (!s) return Promise.resolve(null);
      if (filter.status?.$in && !filter.status.$in.includes(s.status)) {
        return Promise.resolve(null);
      }
      if (update.$set) {
        Object.assign(s, update.$set);
      }
      return Promise.resolve(s);
    });

    // Mock File model methods
    vi.spyOn(File, 'create').mockImplementation((data: any) => {
      const file = {
        ...data,
        _id: new mongoose.Types.ObjectId(),
        isDeleted: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      fileStore.set(file._id.toString(), file);
      return Promise.resolve(file as any);
    });

    vi.spyOn(File, 'findOne').mockImplementation((filter: any) => {
      if (filter.storageKey) {
        for (const f of fileStore.values()) {
          if (f.storageKey === filter.storageKey && !f.isDeleted) {
            return Promise.resolve(f);
          }
        }
      }
      return Promise.resolve(null);
    });
  });

  describe('1. GET /api/v1/uploads/:uploadId/status (Status & Missing Chunk Calculation)', () => {
    it('returns initial status with all chunks missing for a new session', async () => {
      const chunkSize = MIN_CHUNK_SIZE; // 256 KB
      const totalSize = 3 * chunkSize;

      const initRes = await request(app)
        .post('/api/v1/uploads/init')
        .set('Authorization', `Bearer ${tokenUserA}`)
        .send({
          fileName: 'video.mp4',
          totalSize,
          chunkSize,
        });

      expect(initRes.status).toBe(201);
      const uploadId = initRes.body.data.session._id;

      const statusRes = await request(app)
        .get(`/api/v1/uploads/${uploadId}/status`)
        .set('Authorization', `Bearer ${tokenUserA}`);

      expect(statusRes.status).toBe(200);
      expect(statusRes.body.success).toBe(true);

      const status = statusRes.body.data;
      expect(status.uploadId).toBe(uploadId);
      expect(status.fileName).toBe('video.mp4');
      expect(status.totalSize).toBe(totalSize);
      expect(status.chunkSize).toBe(chunkSize);
      expect(status.totalChunks).toBe(3);
      expect(status.uploadedChunks).toEqual([]);
      expect(status.missingChunks).toEqual([0, 1, 2]);
      expect(status.status).toBe('PENDING');
      expect(status.canAcceptChunks).toBe(true);
      expect(status.isAssembling).toBe(false);
      expect(status.isCompleted).toBe(false);
    });

    it('updates status and dynamically calculates missing chunks as chunks arrive', async () => {
      const chunkSize = MIN_CHUNK_SIZE;
      const totalSize = 3 * chunkSize;

      const initRes = await request(app)
        .post('/api/v1/uploads/init')
        .set('Authorization', `Bearer ${tokenUserA}`)
        .send({
          fileName: 'archive.tar',
          totalSize,
          chunkSize,
        });

      const uploadId = initRes.body.data.session._id;

      // Upload Chunk 0
      const chunk0 = Buffer.alloc(chunkSize, 'A');
      await request(app)
        .put(`/api/v1/uploads/${uploadId}/chunks/0`)
        .set('Authorization', `Bearer ${tokenUserA}`)
        .attach('chunk', chunk0, 'chunk_0.bin');

      const status1 = await request(app)
        .get(`/api/v1/uploads/${uploadId}/status`)
        .set('Authorization', `Bearer ${tokenUserA}`);

      expect(status1.status).toBe(200);
      expect(status1.body.data.uploadedChunks).toEqual([0]);
      expect(status1.body.data.missingChunks).toEqual([1, 2]);
      expect(status1.body.data.status).toBe('UPLOADING');
    });

    it('correctly tracks out-of-order chunks (e.g. chunk 2 then chunk 0)', async () => {
      const chunkSize = MIN_CHUNK_SIZE;
      const totalSize = 3 * chunkSize;

      const initRes = await request(app)
        .post('/api/v1/uploads/init')
        .set('Authorization', `Bearer ${tokenUserA}`)
        .send({
          fileName: 'out-of-order.dat',
          totalSize,
          chunkSize,
        });

      const uploadId = initRes.body.data.session._id;

      // Upload chunk 2 first
      const chunk2 = Buffer.alloc(chunkSize, 'C');
      await request(app)
        .put(`/api/v1/uploads/${uploadId}/chunks/2`)
        .set('Authorization', `Bearer ${tokenUserA}`)
        .attach('chunk', chunk2, 'chunk_2.bin');

      // Upload chunk 0 second
      const chunk0 = Buffer.alloc(chunkSize, 'A');
      await request(app)
        .put(`/api/v1/uploads/${uploadId}/chunks/0`)
        .set('Authorization', `Bearer ${tokenUserA}`)
        .attach('chunk', chunk0, 'chunk_0.bin');

      const statusRes = await request(app)
        .get(`/api/v1/uploads/${uploadId}/status`)
        .set('Authorization', `Bearer ${tokenUserA}`);

      expect(statusRes.status).toBe(200);
      expect(statusRes.body.data.uploadedChunks).toEqual([0, 2]);
      expect(statusRes.body.data.missingChunks).toEqual([1]);
    });

    it('detects physically missing chunk from storage and re-adds it to missingChunks', async () => {
      const chunkSize = MIN_CHUNK_SIZE;
      const totalSize = 2 * chunkSize;

      const initRes = await request(app)
        .post('/api/v1/uploads/init')
        .set('Authorization', `Bearer ${tokenUserA}`)
        .send({
          fileName: 'physical-check.bin',
          totalSize,
          chunkSize,
        });

      const uploadId = initRes.body.data.session._id;

      // Upload chunk 0
      const chunk0 = Buffer.alloc(chunkSize, 'A');
      await request(app)
        .put(`/api/v1/uploads/${uploadId}/chunks/0`)
        .set('Authorization', `Bearer ${tokenUserA}`)
        .attach('chunk', chunk0, 'chunk_0.bin');

      // Verify chunk 0 was recorded
      const preStatus = await request(app)
        .get(`/api/v1/uploads/${uploadId}/status`)
        .set('Authorization', `Bearer ${tokenUserA}`);
      expect(preStatus.body.data.uploadedChunks).toEqual([0]);
      expect(preStatus.body.data.missingChunks).toEqual([1]);

      // Manually delete chunk 0 file from disk to simulate storage loss
      const chunk0Path = path.join(testStorageDir, 'chunks', uploadId, 'chunk_0');
      await fs.promises.unlink(chunk0Path);

      // Status query must physically verify chunks and detect chunk 0 is missing
      const postStatus = await request(app)
        .get(`/api/v1/uploads/${uploadId}/status`)
        .set('Authorization', `Bearer ${tokenUserA}`);

      expect(postStatus.status).toBe(200);
      expect(postStatus.body.data.uploadedChunks).toEqual([]);
      expect(postStatus.body.data.missingChunks).toEqual([0, 1]);
    });

    it('rejects status for non-existent session (404 SESSION_NOT_FOUND)', async () => {
      const fakeId = new mongoose.Types.ObjectId().toString();
      const res = await request(app)
        .get(`/api/v1/uploads/${fakeId}/status`)
        .set('Authorization', `Bearer ${tokenUserA}`);

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('SESSION_NOT_FOUND');
    });

    it('rejects cross-user access to status (401 FORBIDDEN)', async () => {
      const initRes = await request(app)
        .post('/api/v1/uploads/init')
        .set('Authorization', `Bearer ${tokenUserA}`)
        .send({
          fileName: 'private.pdf',
          totalSize: MIN_CHUNK_SIZE,
          chunkSize: MIN_CHUNK_SIZE,
        });

      const uploadId = initRes.body.data.session._id;

      const res = await request(app)
        .get(`/api/v1/uploads/${uploadId}/status`)
        .set('Authorization', `Bearer ${tokenUserB}`);

      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });

    it('rejects unauthenticated status requests (401 UNAUTHORIZED)', async () => {
      const fakeId = new mongoose.Types.ObjectId().toString();
      const res = await request(app).get(`/api/v1/uploads/${fakeId}/status`);
      expect(res.status).toBe(401);
    });
  });

  describe('2. Resume Flow (Interrupted Upload & Only Missing Chunks)', () => {
    it('successfully resumes an interrupted upload, uploads only missing chunks, and verifies final assembled file byte-for-byte', async () => {
      const chunkSize = MIN_CHUNK_SIZE;
      const part1 = Buffer.alloc(chunkSize, '1');
      const part2 = Buffer.alloc(chunkSize, '2');
      const part3 = Buffer.alloc(chunkSize, '3');
      const fullFile = Buffer.concat([part1, part2, part3]);
      const expectedChecksum = crypto.createHash('sha256').update(fullFile).digest('hex');

      // Initialize session
      const initRes = await request(app)
        .post('/api/v1/uploads/init')
        .set('Authorization', `Bearer ${tokenUserA}`)
        .send({
          fileName: 'complete-resume.dat',
          totalSize: chunkSize * 3,
          chunkSize,
        });

      const uploadId = initRes.body.data.session._id;

      // Step 1: Upload chunk 0 and chunk 2 (chunk 1 gets interrupted / missed)
      await request(app)
        .put(`/api/v1/uploads/${uploadId}/chunks/0`)
        .set('Authorization', `Bearer ${tokenUserA}`)
        .attach('chunk', part1, 'chunk_0.bin');

      await request(app)
        .put(`/api/v1/uploads/${uploadId}/chunks/2`)
        .set('Authorization', `Bearer ${tokenUserA}`)
        .attach('chunk', part3, 'chunk_2.bin');

      // Step 2: Client reconnects, queries status
      const statusRes = await request(app)
        .get(`/api/v1/uploads/${uploadId}/status`)
        .set('Authorization', `Bearer ${tokenUserA}`);

      expect(statusRes.status).toBe(200);
      expect(statusRes.body.data.missingChunks).toEqual([1]);
      expect(statusRes.body.data.canAcceptChunks).toBe(true);

      // Attempting to complete before uploading missing chunk 1 must fail
      const prematureComplete = await request(app)
        .post(`/api/v1/uploads/${uploadId}/complete`)
        .set('Authorization', `Bearer ${tokenUserA}`);

      expect(prematureComplete.status).toBe(400);
      expect(prematureComplete.body.error.code).toBe('MISSING_CHUNKS');

      // Step 3: Client resumes, uploading ONLY missing chunk 1
      const chunk1Res = await request(app)
        .put(`/api/v1/uploads/${uploadId}/chunks/1`)
        .set('Authorization', `Bearer ${tokenUserA}`)
        .attach('chunk', part2, 'chunk_1.bin');

      expect(chunk1Res.status).toBe(200);
      expect(chunk1Res.body.data.isDuplicate).toBe(false);

      // Check status: all chunks present
      const readyStatus = await request(app)
        .get(`/api/v1/uploads/${uploadId}/status`)
        .set('Authorization', `Bearer ${tokenUserA}`);

      expect(readyStatus.body.data.missingChunks).toEqual([]);
      expect(readyStatus.body.data.uploadedChunks).toEqual([0, 1, 2]);

      // Step 4: Finalize assembly
      const completeRes = await request(app)
        .post(`/api/v1/uploads/${uploadId}/complete`)
        .set('Authorization', `Bearer ${tokenUserA}`);

      expect(completeRes.status).toBe(201);
      expect(completeRes.body.success).toBe(true);
      expect(completeRes.body.data.file.name).toBe('complete-resume.dat');
      expect(completeRes.body.data.file.size).toBe(chunkSize * 3);
      expect(completeRes.body.data.file.checksum).toBe(expectedChecksum);

      // Verify physical assembled file on storage matches original bytes exactly
      const assembledBytes = await localStorage.download(completeRes.body.data.file.storageKey);
      expect(assembledBytes.equals(fullFile)).toBe(true);

      // Clean up assembled file
      await localStorage.delete(completeRes.body.data.file.storageKey);
    });

    it('idempotently handles repeated complete requests on an already completed upload', async () => {
      const chunkSize = MIN_CHUNK_SIZE;
      const fileData = Buffer.alloc(chunkSize, 'Z');
      const initRes = await request(app)
        .post('/api/v1/uploads/init')
        .set('Authorization', `Bearer ${tokenUserA}`)
        .send({
          fileName: 'idempotent-complete.txt',
          totalSize: chunkSize,
          chunkSize,
        });

      const uploadId = initRes.body.data.session._id;

      await request(app)
        .put(`/api/v1/uploads/${uploadId}/chunks/0`)
        .set('Authorization', `Bearer ${tokenUserA}`)
        .attach('chunk', fileData, 'chunk_0.bin');

      // First complete
      const firstComplete = await request(app)
        .post(`/api/v1/uploads/${uploadId}/complete`)
        .set('Authorization', `Bearer ${tokenUserA}`);

      expect(firstComplete.status).toBe(201);
      const createdFileId = firstComplete.body.data.file._id;

      // Second complete must return 201/200 with same file
      const secondComplete = await request(app)
        .post(`/api/v1/uploads/${uploadId}/complete`)
        .set('Authorization', `Bearer ${tokenUserA}`);

      expect([200, 201]).toContain(secondComplete.status);
      expect(secondComplete.body.data.file._id).toBe(createdFileId);

      // Status endpoint now reflects completed state
      const statusRes = await request(app)
        .get(`/api/v1/uploads/${uploadId}/status`)
        .set('Authorization', `Bearer ${tokenUserA}`);

      expect(statusRes.body.data.status).toBe('COMPLETED');
      expect(statusRes.body.data.isCompleted).toBe(true);
      expect(statusRes.body.data.canAcceptChunks).toBe(false);
      expect(statusRes.body.data.fileId).toBe(createdFileId);

      await localStorage.delete(firstComplete.body.data.file.storageKey);
    });
  });

  describe('3. Idempotent Retry & Duplicate Conflict Handling', () => {
    it('retrying an identical chunk succeeds idempotently (200 OK, isDuplicate: true)', async () => {
      const chunkSize = MIN_CHUNK_SIZE;
      const initRes = await request(app)
        .post('/api/v1/uploads/init')
        .set('Authorization', `Bearer ${tokenUserA}`)
        .send({
          fileName: 'retry-test.bin',
          totalSize: chunkSize * 2,
          chunkSize,
        });

      const uploadId = initRes.body.data.session._id;
      const chunkData = Buffer.alloc(chunkSize, 'R');

      // First upload
      const firstRes = await request(app)
        .put(`/api/v1/uploads/${uploadId}/chunks/0`)
        .set('Authorization', `Bearer ${tokenUserA}`)
        .attach('chunk', chunkData, 'chunk_0.bin');

      expect(firstRes.status).toBe(200);
      expect(firstRes.body.data.isDuplicate).toBe(false);

      // Retry upload with exact same chunk
      const retryRes = await request(app)
        .put(`/api/v1/uploads/${uploadId}/chunks/0`)
        .set('Authorization', `Bearer ${tokenUserA}`)
        .attach('chunk', chunkData, 'chunk_0.bin');

      expect(retryRes.status).toBe(200);
      expect(retryRes.body.data.isDuplicate).toBe(true);
      expect(retryRes.body.data.checksum).toBe(firstRes.body.data.checksum);
    });

    it('rejects a duplicate chunk sent with conflicting content (409 Conflict)', async () => {
      const chunkSize = MIN_CHUNK_SIZE;
      const initRes = await request(app)
        .post('/api/v1/uploads/init')
        .set('Authorization', `Bearer ${tokenUserA}`)
        .send({
          fileName: 'conflict-test.bin',
          totalSize: chunkSize * 2,
          chunkSize,
        });

      const uploadId = initRes.body.data.session._id;
      const validChunk = Buffer.alloc(chunkSize, 'V');
      const conflictChunk = Buffer.alloc(chunkSize, 'C');

      // Upload valid chunk
      await request(app)
        .put(`/api/v1/uploads/${uploadId}/chunks/0`)
        .set('Authorization', `Bearer ${tokenUserA}`)
        .attach('chunk', validChunk, 'chunk_0.bin');

      // Upload conflicting chunk with same chunkNumber but different content
      const conflictRes = await request(app)
        .put(`/api/v1/uploads/${uploadId}/chunks/0`)
        .set('Authorization', `Bearer ${tokenUserA}`)
        .attach('chunk', conflictChunk, 'chunk_0.bin');

      expect(conflictRes.status).toBe(409);
      expect(conflictRes.body.error.code).toBe('DUPLICATE_CHUNK_CONFLICT');
    });
  });

  describe('4. Session Cancellation, Expiration & State Guards', () => {
    it('cancels active session, cleans up temporary chunks, and marks status CANCELLED', async () => {
      const chunkSize = MIN_CHUNK_SIZE;
      const initRes = await request(app)
        .post('/api/v1/uploads/init')
        .set('Authorization', `Bearer ${tokenUserA}`)
        .send({
          fileName: 'cancel-test.bin',
          totalSize: chunkSize * 2,
          chunkSize,
        });

      const uploadId = initRes.body.data.session._id;

      // Upload chunk 0
      await request(app)
        .put(`/api/v1/uploads/${uploadId}/chunks/0`)
        .set('Authorization', `Bearer ${tokenUserA}`)
        .attach('chunk', Buffer.alloc(chunkSize, 'A'), 'chunk_0.bin');

      // Chunk file exists before cancellation
      const chunk0Exists = await localStorage.chunkExists(uploadId, 0);
      expect(chunk0Exists).toBe(true);

      // Cancel upload
      const cancelRes = await request(app)
        .delete(`/api/v1/uploads/${uploadId}`)
        .set('Authorization', `Bearer ${tokenUserA}`);

      expect(cancelRes.status).toBe(200);

      // Chunks must be deleted on disk
      const chunk0ExistsAfter = await localStorage.chunkExists(uploadId, 0);
      expect(chunk0ExistsAfter).toBe(false);

      // Status should report CANCELLED and canAcceptChunks: false
      const statusRes = await request(app)
        .get(`/api/v1/uploads/${uploadId}/status`)
        .set('Authorization', `Bearer ${tokenUserA}`);

      expect(statusRes.body.data.status).toBe('CANCELLED');
      expect(statusRes.body.data.canAcceptChunks).toBe(false);

      // Subsequent chunk uploads must be rejected
      const chunkAfterCancel = await request(app)
        .put(`/api/v1/uploads/${uploadId}/chunks/1`)
        .set('Authorization', `Bearer ${tokenUserA}`)
        .attach('chunk', Buffer.alloc(chunkSize, 'B'), 'chunk_1.bin');

      expect(chunkAfterCancel.status).toBe(400);
      expect(chunkAfterCancel.body.error.code).toBe('INVALID_SESSION_STATE');
    });

    it('rejects cancellation of an already completed session (400 SESSION_ALREADY_COMPLETED)', async () => {
      const chunkSize = MIN_CHUNK_SIZE;
      const fileData = Buffer.alloc(chunkSize, 'D');
      const initRes = await request(app)
        .post('/api/v1/uploads/init')
        .set('Authorization', `Bearer ${tokenUserA}`)
        .send({
          fileName: 'no-cancel-completed.txt',
          totalSize: chunkSize,
          chunkSize,
        });

      const uploadId = initRes.body.data.session._id;

      await request(app)
        .put(`/api/v1/uploads/${uploadId}/chunks/0`)
        .set('Authorization', `Bearer ${tokenUserA}`)
        .attach('chunk', fileData, 'chunk_0.bin');

      const completeRes = await request(app)
        .post(`/api/v1/uploads/${uploadId}/complete`)
        .set('Authorization', `Bearer ${tokenUserA}`);

      expect(completeRes.status).toBe(201);

      // Attempt to cancel completed session must fail
      const cancelRes = await request(app)
        .delete(`/api/v1/uploads/${uploadId}`)
        .set('Authorization', `Bearer ${tokenUserA}`);

      expect(cancelRes.status).toBe(400);
      expect(cancelRes.body.error.code).toBe('SESSION_ALREADY_COMPLETED');

      // The assembled file should remain intact
      const fileExists = await localStorage.exists(completeRes.body.data.file.storageKey);
      expect(fileExists).toBe(true);

      await localStorage.delete(completeRes.body.data.file.storageKey);
    });

    it('rejects chunk uploads and completion on expired session (400 SESSION_EXPIRED)', async () => {
      const chunkSize = MIN_CHUNK_SIZE;
      const initRes = await request(app)
        .post('/api/v1/uploads/init')
        .set('Authorization', `Bearer ${tokenUserA}`)
        .send({
          fileName: 'expired-test.txt',
          totalSize: chunkSize,
          chunkSize,
        });

      const uploadId = initRes.body.data.session._id;

      // Force expiresAt to the past in database
      const session = sessionStore.get(uploadId);
      session.expiresAt = new Date(Date.now() - 60000);

      // Status query marks it EXPIRED and canAcceptChunks: false
      const statusRes = await request(app)
        .get(`/api/v1/uploads/${uploadId}/status`)
        .set('Authorization', `Bearer ${tokenUserA}`);

      expect(statusRes.body.data.status).toBe('EXPIRED');
      expect(statusRes.body.data.canAcceptChunks).toBe(false);

      // Uploading chunk must fail
      const chunkRes = await request(app)
        .put(`/api/v1/uploads/${uploadId}/chunks/0`)
        .set('Authorization', `Bearer ${tokenUserA}`)
        .attach('chunk', Buffer.alloc(chunkSize, 'E'), 'chunk_0.bin');

      expect(chunkRes.status).toBe(400);
      expect(chunkRes.body.error.code).toBe('SESSION_EXPIRED');

      // Completing must fail
      const completeRes = await request(app)
        .post(`/api/v1/uploads/${uploadId}/complete`)
        .set('Authorization', `Bearer ${tokenUserA}`);

      expect(completeRes.status).toBe(400);
      expect(completeRes.body.error.code).toBe('SESSION_EXPIRED');
    });

    it('rejects cross-user cancellation attempt (401 FORBIDDEN)', async () => {
      const chunkSize = MIN_CHUNK_SIZE;
      const initRes = await request(app)
        .post('/api/v1/uploads/init')
        .set('Authorization', `Bearer ${tokenUserA}`)
        .send({
          fileName: 'private-cancel.txt',
          totalSize: chunkSize,
          chunkSize,
        });

      const uploadId = initRes.body.data.session._id;

      const cancelRes = await request(app)
        .delete(`/api/v1/uploads/${uploadId}`)
        .set('Authorization', `Bearer ${tokenUserB}`);

      expect(cancelRes.status).toBe(401);
      expect(cancelRes.body.error.code).toBe('FORBIDDEN');
    });
  });
});
