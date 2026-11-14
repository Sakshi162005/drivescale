import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import mongoose, { Types } from 'mongoose';
import { Readable } from 'stream';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { Client } from 'minio';

import { createApp } from '../src/app.js';
import { MinioStorageService } from '../src/services/storage/minio-storage.service.js';
import { ensureBucketExists, initStorage } from '../src/config/storage.js';
import { storageService, setStorageService } from '../src/services/storage/index.js';
import { File } from '../src/models/File.js';
import { Folder } from '../src/models/Folder.js';
import { User } from '../src/models/User.js';
import { FileVersion } from '../src/models/FileVersion.js';
import { Share } from '../src/models/Share.js';
import { UploadSession } from '../src/models/UploadSession.js';
import { signAccessToken } from '../src/utils/jwt.js';
import { cacheService } from '../src/services/cache.service.js';
import { NotFoundError, BadRequestError, ConflictError } from '../src/utils/errors.js';

describe('Phase 12 MinIO Object Storage Test Suite', () => {
  let tempChunkDir: string;
  let mockMinioClient: Client;
  let minioStorage: MinioStorageService;

  const app = createApp();

  const userAId = new mongoose.Types.ObjectId().toString();
  const tokenUserA = signAccessToken({ userId: userAId, email: 'usera@example.com', role: 'user' });

  const mockUserA = {
    _id: new mongoose.Types.ObjectId(userAId),
    name: 'User A',
    email: 'usera@example.com',
    storageQuota: 10 * 1024 * 1024 * 1024,
    storageUsed: 1024 * 1024,
    storageReserved: 0,
    isActive: true,
  };

  beforeEach(() => {
    vi.restoreAllMocks();

    tempChunkDir = fs.mkdtempSync(path.join(os.tmpdir(), 'drivescale-minio-test-'));

    // Create mocked Minio client
    mockMinioClient = {
      putObject: vi.fn().mockResolvedValue({ etag: 'mock-etag', versionId: 'mock-v1' }),
      getObject: vi.fn().mockImplementation(async () => Readable.from(Buffer.from('minio object content'))),
      removeObject: vi.fn().mockResolvedValue(undefined),
      statObject: vi.fn().mockResolvedValue({
        size: 20,
        lastModified: new Date('2026-03-01T12:00:00Z'),
        etag: 'mock-etag',
        metaData: { 'content-type': 'text/plain' },
      }),
      bucketExists: vi.fn().mockResolvedValue(true),
      makeBucket: vi.fn().mockResolvedValue(undefined),
    } as unknown as Client;

    minioStorage = new MinioStorageService(mockMinioClient, 'drivescale', tempChunkDir);

    // Mock cacheService
    vi.spyOn(cacheService, 'get').mockResolvedValue(null);
    vi.spyOn(cacheService, 'set').mockResolvedValue(undefined);
    vi.spyOn(cacheService, 'del').mockResolvedValue(undefined);
    vi.spyOn(cacheService, 'delByPattern').mockResolvedValue(undefined);

    // Mock User lookup
    vi.spyOn(User, 'findById').mockResolvedValue(mockUserA as any);
    vi.spyOn(User, 'findByIdAndUpdate').mockResolvedValue(mockUserA as any);
  });

  afterEach(() => {
    try {
      fs.rmSync(tempChunkDir, { recursive: true, force: true });
    } catch {
      // Ignore
    }
  });

  describe('1. MinioStorageService Adapter Operations', () => {
    it('uploads a stream to MinIO, calculates SHA-256 and size on the fly without memory buffering', async () => {
      const data = 'Hello, MinIO Object Storage! Streaming test.';
      const stream = Readable.from(Buffer.from(data));
      const key = 'objects/1a/1a2b3c4d5e6f7a8b';

      const result = await minioStorage.upload(key, stream);

      expect(mockMinioClient.putObject).toHaveBeenCalledWith(
        'drivescale',
        key,
        expect.anything() // Inspector Transform stream
      );
      expect(result.size).toBe(Buffer.byteLength(data));
      expect(typeof result.checksum).toBe('string');
      expect(result.checksum.length).toBe(64); // SHA-256 hex
    });

    it('rejects path traversal attempts and invalid storage keys', async () => {
      const stream = Readable.from(Buffer.from('malicious payload'));

      await expect(minioStorage.upload('../secret.txt', stream)).rejects.toThrow(BadRequestError);
      await expect(minioStorage.upload('/root/file.txt', stream)).rejects.toThrow(BadRequestError);
      await expect(minioStorage.upload('objects/\0nullbyte', stream)).rejects.toThrow(BadRequestError);
    });

    it('creates a readable download stream for stored object', async () => {
      const key = 'objects/ab/abcdef123456';
      const readStream = await minioStorage.createReadStream(key);

      expect(mockMinioClient.getObject).toHaveBeenCalledWith('drivescale', key);

      const chunks: Buffer[] = [];
      for await (const chunk of readStream) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }
      expect(Buffer.concat(chunks).toString()).toBe('minio object content');
    });

    it('throws NotFoundError (STORAGE_OBJECT_NOT_FOUND) when reading non-existent object', async () => {
      vi.spyOn(mockMinioClient, 'getObject').mockRejectedValue({
        code: 'NotFound',
        message: 'The specified key does not exist.',
      });

      await expect(minioStorage.createReadStream('objects/00/nonexistent')).rejects.toThrow(
        NotFoundError
      );
    });

    it('downloads complete buffer from MinIO stream', async () => {
      const buf = await minioStorage.download('objects/ab/test-buffer');
      expect(buf).toBeInstanceOf(Buffer);
      expect(buf.toString()).toBe('minio object content');
    });

    it('checks object existence correctly (true for found, false for NotFound)', async () => {
      const exists = await minioStorage.exists('objects/ab/existing');
      expect(exists).toBe(true);

      vi.spyOn(mockMinioClient, 'statObject').mockRejectedValue({
        code: 'NotFound',
      });

      const missing = await minioStorage.exists('objects/ab/missing');
      expect(missing).toBe(false);

      // Traversal returns false safely without crashing
      expect(await minioStorage.exists('../evil.sh')).toBe(false);
    });

    it('retrieves object metadata and maps attributes cleanly', async () => {
      const meta = await minioStorage.getMetadata('objects/ab/meta-test');

      expect(meta.size).toBe(20);
      expect(meta.lastModified).toEqual(new Date('2026-03-01T12:00:00Z'));
      expect(meta.contentType).toBe('text/plain');
      expect(meta.checksum).toBe('mock-etag');
    });

    it('throws NotFoundError when getting metadata for missing object', async () => {
      vi.spyOn(mockMinioClient, 'statObject').mockRejectedValue({
        code: 'NoSuchKey',
      });

      await expect(minioStorage.getMetadata('objects/ab/meta-missing')).rejects.toThrow(NotFoundError);
    });

    it('deletes stored object from MinIO idempotently', async () => {
      await minioStorage.delete('objects/ab/to-delete');
      expect(mockMinioClient.removeObject).toHaveBeenCalledWith('drivescale', 'objects/ab/to-delete');
    });
  });

  describe('2. Temporary Chunk Staging & MinIO Assembly', () => {
    it('saves chunks to temporary directory with checksum validation', async () => {
      const uploadId = 'session-123';
      const chunkData = 'Chunk zero payload';
      const stream = Readable.from(Buffer.from(chunkData));

      const result = await minioStorage.saveChunk(uploadId, 0, stream);
      expect(result.size).toBe(Buffer.byteLength(chunkData));
      expect(result.checksum.length).toBe(64);

      const exists = await minioStorage.chunkExists(uploadId, 0);
      expect(exists).toBe(true);
    });

    it('rejects chunk when expectedChecksum does not match calculated hash', async () => {
      const uploadId = 'session-mismatch';
      const stream = Readable.from(Buffer.from('data'));

      await expect(
        minioStorage.saveChunk(uploadId, 0, stream, 'wrong-sha256-hash')
      ).rejects.toThrow(ConflictError);

      expect(await minioStorage.chunkExists(uploadId, 0)).toBe(false);
    });

    it('assembles all chunks sequentially into MinIO and purges temporary files', async () => {
      const uploadId = 'session-assembly';

      await minioStorage.saveChunk(uploadId, 0, Readable.from(Buffer.from('Part1-')));
      await minioStorage.saveChunk(uploadId, 1, Readable.from(Buffer.from('Part2-')));
      await minioStorage.saveChunk(uploadId, 2, Readable.from(Buffer.from('Part3')));

      const targetKey = 'objects/cc/assembled-file.bin';
      const result = await minioStorage.assembleChunks(uploadId, 3, targetKey);

      expect(mockMinioClient.putObject).toHaveBeenCalledWith(
        'drivescale',
        targetKey,
        expect.anything()
      );
      expect(result.size).toBe(Buffer.byteLength('Part1-Part2-Part3'));

      // Verified temporary chunks are purged
      expect(await minioStorage.chunkExists(uploadId, 0)).toBe(false);
      expect(await minioStorage.chunkExists(uploadId, 1)).toBe(false);
      expect(await minioStorage.chunkExists(uploadId, 2)).toBe(false);
    });

    it('fails assembly if an intermediate chunk is missing', async () => {
      const uploadId = 'session-incomplete';
      await minioStorage.saveChunk(uploadId, 0, Readable.from(Buffer.from('Part1')));
      // Chunk 1 missing

      await expect(
        minioStorage.assembleChunks(uploadId, 2, 'objects/cc/target.bin')
      ).rejects.toThrow(NotFoundError);
    });
  });

  describe('3. Bucket Lifecycle & Idempotent Initialization', () => {
    it('verifies existing bucket without recreating it', async () => {
      vi.spyOn(mockMinioClient, 'bucketExists').mockResolvedValue(true);
      const makeBucketSpy = vi.spyOn(mockMinioClient, 'makeBucket');

      const ok = await ensureBucketExists(mockMinioClient, 'drivescale', 2, 10);
      expect(ok).toBe(true);
      expect(makeBucketSpy).not.toHaveBeenCalled();
    });

    it('creates bucket if it does not exist', async () => {
      vi.spyOn(mockMinioClient, 'bucketExists').mockResolvedValue(false);
      const makeBucketSpy = vi.spyOn(mockMinioClient, 'makeBucket').mockResolvedValue(undefined);

      const ok = await ensureBucketExists(mockMinioClient, 'drivescale', 2, 10);
      expect(ok).toBe(true);
      expect(makeBucketSpy).toHaveBeenCalledWith('drivescale');
    });

    it('handles concurrent race condition (BucketAlreadyOwnedByYou) safely', async () => {
      vi.spyOn(mockMinioClient, 'bucketExists').mockResolvedValue(false);
      vi.spyOn(mockMinioClient, 'makeBucket').mockRejectedValue(
        new Error('BucketAlreadyOwnedByYou: Your previous request to create the named bucket succeeded and you already own it.')
      );

      const ok = await ensureBucketExists(mockMinioClient, 'drivescale', 2, 10);
      expect(ok).toBe(true);
    });

    it('retries bounded number of times when MinIO is temporarily unavailable', async () => {
      const bucketExistsSpy = vi
        .spyOn(mockMinioClient, 'bucketExists')
        .mockRejectedValue(new Error('ECONNREFUSED'));

      const ok = await ensureBucketExists(mockMinioClient, 'drivescale', 3, 5);
      expect(ok).toBe(false);
      expect(bucketExistsSpy).toHaveBeenCalledTimes(3);
    });

    it('initStorage initializes MinIO bucket successfully', async () => {
      vi.spyOn(mockMinioClient, 'bucketExists').mockResolvedValue(true);
      const ok = await initStorage(mockMinioClient);
      expect(ok).toBe(true);
    });
  });

  describe('4. End-to-End API Integration with MinIO Active Storage', () => {
    beforeEach(() => {
      // Set active storageService to our tested minioStorage instance
      setStorageService(minioStorage);
    });

    it('POST /api/v1/files uploads directly to MinIO and updates MongoDB metadata', async () => {
      const fileId = new mongoose.Types.ObjectId();
      vi.spyOn(File, 'findOne').mockResolvedValue(null);
      vi.spyOn(File, 'create').mockResolvedValue({
        _id: fileId,
        name: 'test-document.txt',
        ownerId: new mongoose.Types.ObjectId(userAId),
        folderId: null,
        storageKey: 'objects/aa/test-document',
        size: 100,
        mimeType: 'text/plain',
        checksum: 'mock-sha256',
        createdAt: new Date(),
        updatedAt: new Date(),
      } as any);

      const putObjectSpy = vi.spyOn(mockMinioClient, 'putObject');

      const res = await request(app)
        .post('/api/v1/files')
        .set('Authorization', `Bearer ${tokenUserA}`)
        .attach('file', Buffer.from('Testing MinIO direct multipart upload streaming'), 'test-document.txt');

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(putObjectSpy).toHaveBeenCalled();
    });

    it('GET /api/v1/files/:id/download streams object bytes directly from MinIO', async () => {
      const fileId = new mongoose.Types.ObjectId();
      const payload = 'MinIO streamed payload';
      vi.spyOn(File, 'findById').mockResolvedValue({
        _id: fileId,
        name: 'readme.txt',
        ownerId: new mongoose.Types.ObjectId(userAId),
        folderId: null,
        storageKey: 'objects/aa/readme-key',
        size: Buffer.byteLength(payload),
        mimeType: 'text/plain',
        isDeleted: false,
      } as any);

      const getObjectSpy = vi.spyOn(mockMinioClient, 'getObject').mockResolvedValue(
        Readable.from(Buffer.from(payload)) as any
      );

      const res = await request(app)
        .get(`/api/v1/files/${fileId.toString()}/download`)
        .set('Authorization', `Bearer ${tokenUserA}`);

      expect(res.status).toBe(200);
      expect(res.text).toBe(payload);
      expect(getObjectSpy).toHaveBeenCalledWith('drivescale', 'objects/aa/readme-key');
    });

    it('DELETE /api/v1/trash/files/:id/permanent removes object from MinIO', async () => {
      const fileId = new mongoose.Types.ObjectId();
      const storageKey = 'objects/dd/permanent-delete-key';

      vi.spyOn(File, 'findById').mockResolvedValue({
        _id: fileId,
        name: 'old.log',
        ownerId: new mongoose.Types.ObjectId(userAId),
        storageKey,
        isDeleted: true,
      } as any);
      vi.spyOn(FileVersion, 'find').mockResolvedValue([] as any);
      vi.spyOn(FileVersion, 'deleteMany').mockResolvedValue({ deletedCount: 0 } as any);
      vi.spyOn(Share, 'deleteMany').mockResolvedValue({ deletedCount: 0 } as any);
      vi.spyOn(File, 'findByIdAndDelete').mockResolvedValue({} as any);

      const removeObjectSpy = vi.spyOn(mockMinioClient, 'removeObject');

      const res = await request(app)
        .delete(`/api/v1/trash/files/${fileId.toString()}/permanent`)
        .set('Authorization', `Bearer ${tokenUserA}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(removeObjectSpy).toHaveBeenCalledWith('drivescale', storageKey);
    });
  });
});
