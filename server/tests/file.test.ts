import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import request from 'supertest';
import mongoose from 'mongoose';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { Readable } from 'stream';
import { createApp } from '../src/app.js';
import { File } from '../src/models/File.js';
import { Folder } from '../src/models/Folder.js';
import { User } from '../src/models/User.js';
import { signAccessToken } from '../src/utils/jwt.js';
import { LocalStorageService } from '../src/services/storage/local-storage.service.js';
import { storageService } from '../src/services/storage/index.js';

describe('Phase 3 File Storage Test Suite', () => {
  const app = createApp();

  const userAId = new mongoose.Types.ObjectId().toString();
  const userBId = new mongoose.Types.ObjectId().toString();

  const tokenUserA = signAccessToken({ userId: userAId, email: 'usera@example.com', role: 'user' });
  const tokenUserB = signAccessToken({ userId: userBId, email: 'userb@example.com', role: 'user' });

  // Temporary test directory for real LocalStorageService testing
  const testStorageDir = path.join(os.tmpdir(), `drivescale-test-${Date.now()}`);

  afterAll(async () => {
    try {
      await fs.promises.rm(testStorageDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup error
    }
  });

  beforeEach(() => {
    vi.restoreAllMocks();

    // Mock User.findById for auth middleware and quota checks
    vi.spyOn(User, 'findById').mockImplementation((id: any) => {
      const idStr = id?.toString();
      if (idStr === userAId) {
        return Promise.resolve({
          _id: new mongoose.Types.ObjectId(userAId),
          name: 'User A',
          email: 'usera@example.com',
          isActive: true,
          storageQuota: 10 * 1024 * 1024 * 1024,
          storageUsed: 1024 * 1024, // 1 MB used
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
  });

  describe('1. LocalStorageService (Streaming & Security)', () => {
    it('uploads a stream and computes exact SHA-256 checksum & byte size', async () => {
      const storage = new LocalStorageService(testStorageDir);
      const testContent = 'Hello DriveScale Streaming Storage!';
      const stream = Readable.from(Buffer.from(testContent));
      const key = 'objects/test/file1.txt';

      const result = await storage.upload(key, stream);

      expect(result.size).toBe(Buffer.byteLength(testContent));
      expect(result.checksum).toBeTruthy();
      expect(await storage.exists(key)).toBe(true);

      const downloaded = await storage.download(key);
      expect(downloaded.toString()).toBe(testContent);

      const meta = await storage.getMetadata(key);
      expect(meta.size).toBe(Buffer.byteLength(testContent));

      await storage.delete(key);
      expect(await storage.exists(key)).toBe(false);
    });

    it('rejects path traversal attempts in storage keys', async () => {
      const storage = new LocalStorageService(testStorageDir);
      const maliciousKeys = [
        '../../etc/passwd',
        '../outside.txt',
        'objects/../../secret.key',
        'foo/bar/../../../etc/shadow',
      ];

      for (const key of maliciousKeys) {
        const stream = Readable.from(Buffer.from('malicious content'));
        await expect(storage.upload(key, stream)).rejects.toThrow(/path traversal/i);
      }
    });
  });

  describe('2. POST /api/v1/files (Streaming Upload)', () => {
    it('successfully uploads a file to root with multipart/form-data', async () => {
      const fakeFileId = new mongoose.Types.ObjectId();
      const fakeFile = {
        _id: fakeFileId,
        name: 'test-document.pdf',
        ownerId: new mongoose.Types.ObjectId(userAId),
        folderId: null,
        storageKey: 'objects/ab/abcdef123456',
        size: 100,
        mimeType: 'application/pdf',
        checksum: 'fakechecksumsha256',
        isDeleted: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      vi.spyOn(File, 'findOne').mockResolvedValue(null);
      vi.spyOn(storageService, 'upload').mockImplementation(async (_key, stream) => {
        stream.resume();
        return { size: 100, checksum: 'fakechecksumsha256' };
      });
      vi.spyOn(File, 'create').mockResolvedValue(fakeFile as any);

      const res = await request(app)
        .post('/api/v1/files')
        .set('Authorization', `Bearer ${tokenUserA}`)
        .attach('file', Buffer.from('file-content-bytes'), 'test-document.pdf');

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.file.name).toBe('test-document.pdf');
      expect(res.body.data.file.folderId).toBeNull();
      // Ensure file bytes are not stored in MongoDB record
      expect(res.body.data.file.data).toBeUndefined();
      expect(res.body.data.file.bytes).toBeUndefined();
    });

    it('successfully uploads a file into an existing folder owned by the user', async () => {
      const folderId = new mongoose.Types.ObjectId();
      vi.spyOn(Folder, 'findById').mockResolvedValue({
        _id: folderId,
        name: 'Work',
        ownerId: new mongoose.Types.ObjectId(userAId),
        isDeleted: false,
      } as any);

      vi.spyOn(File, 'findOne').mockResolvedValue(null);
      vi.spyOn(storageService, 'upload').mockImplementation(async (_key, stream) => {
        stream.resume();
        return { size: 250, checksum: 'sha256sum' };
      });

      const fakeFile = {
        _id: new mongoose.Types.ObjectId(),
        name: 'nested.txt',
        ownerId: new mongoose.Types.ObjectId(userAId),
        folderId,
        storageKey: 'objects/12/123456',
        size: 250,
        mimeType: 'text/plain',
        checksum: 'sha256sum',
      };
      vi.spyOn(File, 'create').mockResolvedValue(fakeFile as any);

      const res = await request(app)
        .post(`/api/v1/files?folderId=${folderId.toString()}`)
        .set('Authorization', `Bearer ${tokenUserA}`)
        .attach('file', Buffer.from('nested content'), 'nested.txt');

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.file.name).toBe('nested.txt');
    });

    it('rejects upload into another user folder (401/403 FORBIDDEN)', async () => {
      const folderId = new mongoose.Types.ObjectId();
      vi.spyOn(Folder, 'findById').mockResolvedValue({
        _id: folderId,
        name: 'User B Private Folder',
        ownerId: new mongoose.Types.ObjectId(userBId), // Owned by User B
        isDeleted: false,
      } as any);
      vi.spyOn(storageService, 'upload').mockImplementation(async (_key, stream) => {
        stream.resume();
        return { size: 100, checksum: 'sum' };
      });

      const res = await request(app)
        .post(`/api/v1/files?folderId=${folderId.toString()}`)
        .set('Authorization', `Bearer ${tokenUserA}`) // User A trying to upload
        .attach('file', Buffer.from('test bytes'), 'hacked.txt');

      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });

    it('rejects upload with duplicate file name in the same folder (409 Conflict)', async () => {
      vi.spyOn(File, 'findOne').mockResolvedValue({
        _id: new mongoose.Types.ObjectId(),
        name: 'duplicate.txt',
        ownerId: new mongoose.Types.ObjectId(userAId),
        folderId: null,
      } as any);
      vi.spyOn(storageService, 'upload').mockImplementation(async (_key, stream) => {
        stream.resume();
        return { size: 100, checksum: 'sum' };
      });

      const res = await request(app)
        .post('/api/v1/files')
        .set('Authorization', `Bearer ${tokenUserA}`)
        .attach('file', Buffer.from('some content'), 'duplicate.txt');

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('FILE_ALREADY_EXISTS');
    });

    it('rejects upload when user storage quota is exceeded (400 STORAGE_QUOTA_EXCEEDED)', async () => {
      vi.spyOn(User, 'findById').mockResolvedValue({
        _id: new mongoose.Types.ObjectId(userAId),
        isActive: true,
        storageQuota: 1000,
        storageUsed: 1000, // Quota already completely full
      } as any);
      vi.spyOn(storageService, 'upload').mockImplementation(async (_key, stream) => {
        stream.resume();
        return { size: 100, checksum: 'sum' };
      });

      vi.spyOn(File, 'findOne').mockResolvedValue(null);

      const res = await request(app)
        .post('/api/v1/files')
        .set('Authorization', `Bearer ${tokenUserA}`)
        .attach('file', Buffer.from('content'), 'overflow.txt');

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('STORAGE_QUOTA_EXCEEDED');
    });
  });

  describe('3. GET /api/v1/files (List Files & Pagination)', () => {
    it('returns paginated file list for authenticated user in root', async () => {
      const mockFiles = [
        { _id: new mongoose.Types.ObjectId(), name: 'file1.txt', size: 100, folderId: null },
        { _id: new mongoose.Types.ObjectId(), name: 'file2.txt', size: 200, folderId: null },
      ];

      vi.spyOn(File, 'find').mockReturnValue({
        sort: vi.fn().mockReturnValue({
          skip: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue(mockFiles),
          }),
        }),
      } as any);

      vi.spyOn(File, 'countDocuments').mockResolvedValue(2);

      const res = await request(app)
        .get('/api/v1/files?page=1&limit=10')
        .set('Authorization', `Bearer ${tokenUserA}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.files.length).toBe(2);
      expect(res.body.data.pagination).toEqual({
        page: 1,
        limit: 10,
        total: 2,
        totalPages: 1,
        hasNextPage: false,
        hasPrevPage: false,
      });
    });
  });

  describe('4. GET /api/v1/files/:id (Get File Metadata)', () => {
    it('returns file metadata for file owner', async () => {
      const fileId = new mongoose.Types.ObjectId();
      const mockFile = {
        _id: fileId,
        name: 'my-resume.pdf',
        ownerId: new mongoose.Types.ObjectId(userAId),
        size: 50000,
        mimeType: 'application/pdf',
        isDeleted: false,
      };

      vi.spyOn(File, 'findById').mockResolvedValue(mockFile as any);

      const res = await request(app)
        .get(`/api/v1/files/${fileId.toString()}`)
        .set('Authorization', `Bearer ${tokenUserA}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.file.name).toBe('my-resume.pdf');
    });

    it('rejects User B accessing User A file metadata (401/403 FORBIDDEN)', async () => {
      const fileId = new mongoose.Types.ObjectId();
      const mockFile = {
        _id: fileId,
        name: 'private-doc.txt',
        ownerId: new mongoose.Types.ObjectId(userAId), // User A's file
        isDeleted: false,
      };

      vi.spyOn(File, 'findById').mockResolvedValue(mockFile as any);

      const res = await request(app)
        .get(`/api/v1/files/${fileId.toString()}`)
        .set('Authorization', `Bearer ${tokenUserB}`); // User B requesting

      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });
  });

  describe('5. GET /api/v1/files/:id/download (Streaming Download)', () => {
    it('streams file content with correct Content-Disposition and Content-Type headers', async () => {
      const fileId = new mongoose.Types.ObjectId();
      const fileContent = 'Streaming file content for testing download';

      const mockFile = {
        _id: fileId,
        name: 'download-me.txt',
        ownerId: new mongoose.Types.ObjectId(userAId),
        storageKey: 'objects/cd/cd1234',
        size: Buffer.byteLength(fileContent),
        mimeType: 'text/plain',
        isDeleted: false,
      };

      vi.spyOn(File, 'findById').mockResolvedValue(mockFile as any);
      vi.spyOn(storageService, 'createReadStream').mockResolvedValue(Readable.from(Buffer.from(fileContent)));

      const res = await request(app)
        .get(`/api/v1/files/${fileId.toString()}/download`)
        .set('Authorization', `Bearer ${tokenUserA}`);

      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toBe('text/plain');
      expect(res.headers['content-disposition']).toContain('attachment; filename="download-me.txt"');
      expect(res.text).toBe(fileContent);
    });

    it('rejects User B downloading User A file (401/403 FORBIDDEN)', async () => {
      const fileId = new mongoose.Types.ObjectId();
      const mockFile = {
        _id: fileId,
        name: 'secret.txt',
        ownerId: new mongoose.Types.ObjectId(userAId),
        isDeleted: false,
      };

      vi.spyOn(File, 'findById').mockResolvedValue(mockFile as any);

      const res = await request(app)
        .get(`/api/v1/files/${fileId.toString()}/download`)
        .set('Authorization', `Bearer ${tokenUserB}`);

      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });
  });

  describe('6. PATCH /api/v1/files/:id (Rename File)', () => {
    it('renames file successfully', async () => {
      const fileId = new mongoose.Types.ObjectId();
      const mockFile = {
        _id: fileId,
        name: 'old-name.txt',
        ownerId: new mongoose.Types.ObjectId(userAId),
        folderId: null,
        isDeleted: false,
        save: vi.fn().mockResolvedValue(true),
      };

      vi.spyOn(File, 'findById').mockResolvedValue(mockFile as any);
      vi.spyOn(File, 'findOne').mockResolvedValue(null);

      const res = await request(app)
        .patch(`/api/v1/files/${fileId.toString()}`)
        .set('Authorization', `Bearer ${tokenUserA}`)
        .send({ name: 'new-name.txt' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(mockFile.name).toBe('new-name.txt');
      expect(mockFile.save).toHaveBeenCalled();
    });

    it('rejects rename with 409 when target filename already exists in folder', async () => {
      const fileId = new mongoose.Types.ObjectId();
      const mockFile = {
        _id: fileId,
        name: 'file1.txt',
        ownerId: new mongoose.Types.ObjectId(userAId),
        folderId: null,
        isDeleted: false,
      };

      vi.spyOn(File, 'findById').mockResolvedValue(mockFile as any);
      vi.spyOn(File, 'findOne').mockResolvedValue({
        _id: new mongoose.Types.ObjectId(),
        name: 'existing.txt',
      } as any);

      const res = await request(app)
        .patch(`/api/v1/files/${fileId.toString()}`)
        .set('Authorization', `Bearer ${tokenUserA}`)
        .send({ name: 'existing.txt' });

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('FILE_ALREADY_EXISTS');
    });
  });

  describe('7. POST /api/v1/files/:id/move (Move File)', () => {
    it('moves file from root into an existing folder', async () => {
      const fileId = new mongoose.Types.ObjectId();
      const targetFolderId = new mongoose.Types.ObjectId();

      const mockFile = {
        _id: fileId,
        name: 'move-me.txt',
        ownerId: new mongoose.Types.ObjectId(userAId),
        folderId: null,
        isDeleted: false,
        save: vi.fn().mockResolvedValue(true),
      };

      vi.spyOn(File, 'findById').mockResolvedValue(mockFile as any);
      vi.spyOn(Folder, 'findById').mockResolvedValue({
        _id: targetFolderId,
        name: 'Target Folder',
        ownerId: new mongoose.Types.ObjectId(userAId),
        isDeleted: false,
      } as any);
      vi.spyOn(File, 'findOne').mockResolvedValue(null);

      const res = await request(app)
        .post(`/api/v1/files/${fileId.toString()}/move`)
        .set('Authorization', `Bearer ${tokenUserA}`)
        .send({ targetFolderId: targetFolderId.toString() });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(mockFile.folderId).toEqual(targetFolderId);
      expect(mockFile.save).toHaveBeenCalled();
    });

    it('rejects moving file into User B folder (401/403 FORBIDDEN)', async () => {
      const fileId = new mongoose.Types.ObjectId();
      const userBFolderId = new mongoose.Types.ObjectId();

      const mockFile = {
        _id: fileId,
        name: 'file.txt',
        ownerId: new mongoose.Types.ObjectId(userAId),
        isDeleted: false,
      };

      vi.spyOn(File, 'findById').mockResolvedValue(mockFile as any);
      vi.spyOn(Folder, 'findById').mockResolvedValue({
        _id: userBFolderId,
        ownerId: new mongoose.Types.ObjectId(userBId), // User B's folder
        isDeleted: false,
      } as any);

      const res = await request(app)
        .post(`/api/v1/files/${fileId.toString()}/move`)
        .set('Authorization', `Bearer ${tokenUserA}`)
        .send({ targetFolderId: userBFolderId.toString() });

      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });
  });

  describe('8. DELETE /api/v1/files/:id (Delete File)', () => {
    it('soft deletes file and decrements user storage usage', async () => {
      const fileId = new mongoose.Types.ObjectId();
      const mockFile = {
        _id: fileId,
        name: 'delete-me.txt',
        ownerId: new mongoose.Types.ObjectId(userAId),
        size: 5000,
        isDeleted: false,
        save: vi.fn().mockResolvedValue(true),
      };

      vi.spyOn(File, 'findById').mockResolvedValue(mockFile as any);
      const updateSpy = vi.spyOn(User, 'findByIdAndUpdate').mockResolvedValue({} as any);

      const res = await request(app)
        .delete(`/api/v1/files/${fileId.toString()}`)
        .set('Authorization', `Bearer ${tokenUserA}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(mockFile.isDeleted).toBe(true);
      expect(mockFile.save).toHaveBeenCalled();
      expect(updateSpy).toHaveBeenCalledWith(
        userAId,
        expect.objectContaining({
          $inc: { storageUsed: -5000 },
        })
      );
    });

    it('rejects User B deleting User A file (401/403 FORBIDDEN)', async () => {
      const fileId = new mongoose.Types.ObjectId();
      const mockFile = {
        _id: fileId,
        ownerId: new mongoose.Types.ObjectId(userAId), // Owned by User A
        isDeleted: false,
      };

      vi.spyOn(File, 'findById').mockResolvedValue(mockFile as any);

      const res = await request(app)
        .delete(`/api/v1/files/${fileId.toString()}`)
        .set('Authorization', `Bearer ${tokenUserB}`); // User B trying to delete

      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });
  });

  describe('9. Authentication Middleware', () => {
    it('rejects unauthenticated requests without token (401 UNAUTHORIZED)', async () => {
      const endpoints = [
        request(app).get('/api/v1/files'),
        request(app).get('/api/v1/files/123456789012345678901234'),
        request(app).get('/api/v1/files/123456789012345678901234/download'),
        request(app).patch('/api/v1/files/123456789012345678901234'),
        request(app).post('/api/v1/files/123456789012345678901234/move'),
        request(app).delete('/api/v1/files/123456789012345678901234'),
      ];

      for (const reqPromise of endpoints) {
        const res = await reqPromise;
        expect(res.status).toBe(401);
        expect(res.body.success).toBe(false);
        expect(res.body.error.code).toBe('UNAUTHORIZED');
      }
    });
  });
});
