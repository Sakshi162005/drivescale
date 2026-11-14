import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Readable } from 'stream';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { Client } from 'minio';
import { MinioStorageService } from '../../src/services/storage/minio-storage.service.js';
import { LocalStorageService } from '../../src/services/storage/local-storage.service.js';
import { BadRequestError, NotFoundError } from '../../src/utils/errors.js';

describe('StorageService Unit Tests (Abstraction & Drivers)', () => {
  let tempBaseDir: string;
  let tempChunksDir: string;

  beforeEach(() => {
    vi.restoreAllMocks();
    tempBaseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'storage-unit-base-'));
    tempChunksDir = fs.mkdtempSync(path.join(os.tmpdir(), 'storage-unit-chunks-'));
  });

  afterEach(() => {
    try {
      fs.rmSync(tempBaseDir, { recursive: true, force: true });
      fs.rmSync(tempChunksDir, { recursive: true, force: true });
    } catch {
      // Ignore
    }
  });

  describe('1. LocalStorageService Unit Operations', () => {
    let localStorage: LocalStorageService;

    beforeEach(() => {
      localStorage = new LocalStorageService(tempBaseDir, tempChunksDir);
    });

    it('uploads a stream to local disk and returns size & SHA-256 checksum', async () => {
      const data = 'Local storage driver unit test content';
      const stream = Readable.from(Buffer.from(data));
      const key = 'objects/11/test-file.txt';

      const result = await localStorage.upload(key, stream);

      expect(result.size).toBe(Buffer.byteLength(data));
      expect(result.checksum.length).toBe(64);

      const exists = await localStorage.exists(key);
      expect(exists).toBe(true);

      const buffer = await localStorage.download(key);
      expect(buffer.toString('utf-8')).toBe(data);
    });

    it('creates a readable stream of stored object', async () => {
      const data = 'Streamed local content';
      const key = 'objects/22/streamed.txt';
      await localStorage.upload(key, Readable.from(Buffer.from(data)));

      const readStream = await localStorage.createReadStream(key);
      const chunks: Buffer[] = [];
      for await (const chunk of readStream) {
        chunks.push(Buffer.from(chunk));
      }
      expect(Buffer.concat(chunks).toString('utf-8')).toBe(data);
    });

    it('throws NotFoundError when downloading non-existent object', async () => {
      await expect(localStorage.download('objects/99/missing.bin')).rejects.toThrow(NotFoundError);
      await expect(localStorage.createReadStream('objects/99/missing.bin')).rejects.toThrow(NotFoundError);
    });

    it('deletes stored object idempotently', async () => {
      const key = 'objects/33/to-delete.txt';
      await localStorage.upload(key, Readable.from(Buffer.from('delete me')));

      expect(await localStorage.exists(key)).toBe(true);
      await localStorage.delete(key);
      expect(await localStorage.exists(key)).toBe(false);

      // Deleting again should succeed idempotently
      await expect(localStorage.delete(key)).resolves.not.toThrow();
    });

    it('rejects path traversal attempts with BadRequestError', async () => {
      const maliciousStream = Readable.from(Buffer.from('exploit'));
      await expect(localStorage.upload('../../etc/passwd', maliciousStream)).rejects.toThrow(BadRequestError);
      await expect(localStorage.exists('../outside.txt')).rejects.toThrow(BadRequestError);
      await expect(localStorage.download('/root/file.txt')).rejects.toThrow(BadRequestError);
    });

    it('stages, verifies, and sequentially assembles chunks', async () => {
      const uploadId = 'unit-upload-session-1';

      await localStorage.saveChunk(uploadId, 0, Readable.from(Buffer.from('Chunk0-')));
      await localStorage.saveChunk(uploadId, 1, Readable.from(Buffer.from('Chunk1-')));
      await localStorage.saveChunk(uploadId, 2, Readable.from(Buffer.from('Chunk2')));

      expect(await localStorage.chunkExists(uploadId, 0)).toBe(true);
      expect(await localStorage.chunkExists(uploadId, 1)).toBe(true);
      expect(await localStorage.chunkExists(uploadId, 2)).toBe(true);
      expect(await localStorage.chunkExists(uploadId, 3)).toBe(false);

      const targetKey = 'objects/44/assembled.bin';
      const assembled = await localStorage.assembleChunks(uploadId, 3, targetKey);

      expect(assembled.size).toBe(Buffer.byteLength('Chunk0-Chunk1-Chunk2'));

      const downloaded = await localStorage.download(targetKey);
      expect(downloaded.toString('utf-8')).toBe('Chunk0-Chunk1-Chunk2');

      // Chunks directory should be cleaned up
      expect(await localStorage.chunkExists(uploadId, 0)).toBe(false);
    });
  });

  describe('2. MinioStorageService Unit Operations (Mocked Client)', () => {
    let mockMinioClient: Client;
    let minioStorage: MinioStorageService;

    beforeEach(() => {
      mockMinioClient = {
        putObject: vi.fn().mockResolvedValue({ etag: 'mock-etag' }),
        getObject: vi.fn().mockImplementation(async () => Readable.from(Buffer.from('minio object bytes'))),
        removeObject: vi.fn().mockResolvedValue(undefined),
        statObject: vi.fn().mockResolvedValue({
          size: 18,
          lastModified: new Date('2026-06-01T00:00:00Z'),
          etag: 'mock-etag',
          metaData: { 'content-type': 'text/plain' },
        }),
        bucketExists: vi.fn().mockResolvedValue(true),
      } as unknown as Client;

      minioStorage = new MinioStorageService(mockMinioClient, 'test-bucket', tempChunksDir);
    });

    it('uploads object stream directly to MinIO and computes SHA-256', async () => {
      const data = 'MinIO upload unit test';
      const key = 'objects/55/minio-file.txt';

      const result = await minioStorage.upload(key, Readable.from(Buffer.from(data)));

      expect(mockMinioClient.putObject).toHaveBeenCalledWith(
        'test-bucket',
        key,
        expect.anything()
      );
      expect(result.size).toBe(Buffer.byteLength(data));
      expect(result.checksum.length).toBe(64);
    });

    it('creates read stream and downloads buffered payload from MinIO', async () => {
      const key = 'objects/66/download-file.txt';
      const buffer = await minioStorage.download(key);

      expect(mockMinioClient.getObject).toHaveBeenCalledWith('test-bucket', key);
      expect(buffer.toString('utf-8')).toBe('minio object bytes');
    });

    it('handles missing object on MinIO and throws NotFoundError', async () => {
      vi.spyOn(mockMinioClient, 'getObject').mockRejectedValue({ code: 'NotFound' });

      await expect(minioStorage.download('objects/77/missing.bin')).rejects.toThrow(NotFoundError);
    });

    it('deletes object from MinIO bucket', async () => {
      const key = 'objects/88/to-delete.txt';
      await minioStorage.delete(key);

      expect(mockMinioClient.removeObject).toHaveBeenCalledWith('test-bucket', key);
    });

    it('retrieves object metadata from MinIO statObject', async () => {
      const key = 'objects/99/meta-file.txt';
      const meta = await minioStorage.getMetadata(key);

      expect(mockMinioClient.statObject).toHaveBeenCalledWith('test-bucket', key);
      expect(meta.size).toBe(18);
      expect(meta.contentType).toBe('text/plain');
    });
  });
});

