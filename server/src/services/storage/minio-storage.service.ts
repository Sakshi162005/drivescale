import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { Transform, Readable } from 'stream';
import { Client } from 'minio';
import {
  IStorageService,
  StorageMetadata,
  StorageUploadResult,
} from './storage.interface.js';
import {
  BadRequestError,
  NotFoundError,
  ConflictError,
  InternalServerError,
} from '../../utils/errors.js';
import { logger } from '../../utils/logger.js';

export class MinioStorageService implements IStorageService {
  private readonly client: Client;
  private readonly bucket: string;
  private readonly chunkDir: string;

  constructor(client: Client, bucket: string, temporaryChunkDir?: string) {
    this.client = client;
    this.bucket = bucket;
    this.chunkDir = temporaryChunkDir
      ? path.resolve(temporaryChunkDir)
      : path.resolve(
          process.env['STORAGE_CHUNKS_DIR'] ||
            path.join(process.cwd(), 'data', 'storage', 'chunks')
        );

    // Ensure temporary chunk directory exists
    if (!fs.existsSync(this.chunkDir)) {
      fs.mkdirSync(this.chunkDir, { recursive: true });
    }
  }

  /**
   * Validates storage key against null bytes and path traversal attempts
   */
  public validateStorageKey(key: string): void {
    if (!key || typeof key !== 'string' || key.includes('\0')) {
      throw new BadRequestError('Invalid storage key format', 'INVALID_STORAGE_KEY');
    }

    // Storage keys must not have relative traversal markers or root backslashes
    if (key.includes('..') || key.startsWith('/') || key.startsWith('\\')) {
      logger.warn({ key }, 'Invalid storage key or path traversal attempt detected');
      throw new BadRequestError(
        'Invalid storage key: path traversal detected',
        'PATH_TRAVERSAL'
      );
    }
  }

  /**
   * Returns temporary filesystem path for an upload session chunk
   */
  private getChunkPath(uploadId: string, chunkNumber: number): string {
    return path.join(this.chunkDir, uploadId, `chunk_${chunkNumber}`);
  }

  /**
   * Uploads a stream directly to MinIO, calculating size and SHA-256 checksum on the fly
   */
  async upload(key: string, stream: NodeJS.ReadableStream): Promise<StorageUploadResult> {
    this.validateStorageKey(key);

    const hash = crypto.createHash('sha256');
    let size = 0;
    let isEnded = false;
    let checksum = '';

    const inspector = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        size += buf.length;
        if (!isEnded) {
          hash.update(buf);
        }
        callback(null, buf);
      },
    });

    inspector.on('end', () => {
      if (!isEnded) {
        isEnded = true;
        checksum = hash.digest('hex');
      }
    });

    try {
      const monitoredStream = (stream as Readable).pipe(inspector);

      // Start MinIO putObject
      await this.client.putObject(this.bucket, key, monitoredStream);

      // Ensure stream has completely flushed and ended (handles immediate mock resolutions cleanly)
      if (!isEnded) {
        await new Promise<void>((resolve, reject) => {
          inspector.on('end', () => {
            if (!isEnded) {
              isEnded = true;
              checksum = hash.digest('hex');
            }
            resolve();
          });
          inspector.on('error', reject);
          inspector.resume();
        });
      }

      logger.info({ key, size, bucket: this.bucket }, 'Object uploaded to MinIO successfully');
      return { size, checksum };
    } catch (err: unknown) {
      logger.error({ key, bucket: this.bucket, err }, 'Failed to upload object to MinIO');

      // Attempt cleanup on failed upload
      try {
        await this.client.removeObject(this.bucket, key);
      } catch {
        // Ignore cleanup failure
      }

      if (err instanceof BadRequestError || err instanceof NotFoundError) {
        throw err;
      }
      throw new InternalServerError('Failed to store object in MinIO storage', 'STORAGE_UPLOAD_FAILED');
    }
  }

  /**
   * Creates a readable stream for reading object bytes directly from MinIO
   */
  async createReadStream(key: string): Promise<NodeJS.ReadableStream> {
    this.validateStorageKey(key);

    try {
      const stream = await this.client.getObject(this.bucket, key);
      return stream;
    } catch (err: unknown) {
      const errorObj = err as { code?: string; message?: string } | undefined;
      const errorCode = errorObj?.code || '';
      const errorMsg = errorObj?.message || String(err);

      if (
        errorCode === 'NotFound' ||
        errorCode === 'NoSuchKey' ||
        errorMsg.includes('Not Found') ||
        errorMsg.includes('not found') ||
        errorMsg.includes('does not exist')
      ) {
        throw new NotFoundError('Storage object not found', 'STORAGE_OBJECT_NOT_FOUND');
      }

      logger.error({ key, bucket: this.bucket, err }, 'Failed to get object stream from MinIO');
      throw new InternalServerError('Failed to retrieve storage object stream', 'STORAGE_READ_FAILED');
    }
  }

  /**
   * Downloads complete object bytes as a Buffer
   */
  async download(key: string): Promise<Buffer> {
    const stream = await this.createReadStream(key);
    const chunks: Buffer[] = [];

    for await (const chunk of stream) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }

    return Buffer.concat(chunks);
  }

  /**
   * Deletes an object from MinIO storage (idempotent)
   */
  async delete(key: string): Promise<void> {
    this.validateStorageKey(key);

    try {
      await this.client.removeObject(this.bucket, key);
      logger.info({ key, bucket: this.bucket }, 'Object deleted from MinIO successfully');
    } catch (err) {
      logger.warn({ key, bucket: this.bucket, err }, 'Error removing object from MinIO');
    }
  }

  /**
   * Checks whether an object exists in MinIO
   */
  async exists(key: string): Promise<boolean> {
    if (!key || typeof key !== 'string' || key.includes('..') || key.includes('\0')) {
      return false;
    }

    try {
      await this.client.statObject(this.bucket, key);
      return true;
    } catch (err: unknown) {
      const errorObj = err as { code?: string; message?: string } | undefined;
      const errorCode = errorObj?.code || '';
      const errorMsg = errorObj?.message || '';

      if (
        errorCode === 'NotFound' ||
        errorCode === 'NoSuchKey' ||
        errorMsg.includes('Not Found') ||
        errorMsg.includes('not found')
      ) {
        return false;
      }

      logger.warn({ key, bucket: this.bucket, err }, 'Error checking object existence in MinIO');
      return false;
    }
  }

  /**
   * Retrieves object metadata from MinIO
   */
  async getMetadata(key: string): Promise<StorageMetadata> {
    this.validateStorageKey(key);

    try {
      const stat = await this.client.statObject(this.bucket, key);
      return {
        size: stat.size,
        lastModified: stat.lastModified,
        contentType: stat.metaData?.['content-type'],
        checksum: stat.etag,
      };
    } catch (err: unknown) {
      const errorObj = err as { code?: string; message?: string } | undefined;
      const errorCode = errorObj?.code || '';
      const errorMsg = errorObj?.message || '';

      if (
        errorCode === 'NotFound' ||
        errorCode === 'NoSuchKey' ||
        errorMsg.includes('Not Found') ||
        errorMsg.includes('not found')
      ) {
        throw new NotFoundError('Storage object not found', 'STORAGE_OBJECT_NOT_FOUND');
      }

      logger.error({ key, bucket: this.bucket, err }, 'Failed to retrieve object metadata from MinIO');
      throw new InternalServerError('Failed to retrieve object metadata', 'STORAGE_METADATA_FAILED');
    }
  }

  /**
   * Saves a temporary chunk for an upload session
   */
  async saveChunk(
    uploadId: string,
    chunkNumber: number,
    stream: NodeJS.ReadableStream,
    expectedChecksum?: string
  ): Promise<StorageUploadResult> {
    if (!uploadId || typeof uploadId !== 'string' || uploadId.includes('..') || uploadId.includes('\0')) {
      throw new BadRequestError('Invalid upload session ID', 'INVALID_SESSION_ID');
    }
    if (chunkNumber < 0 || !Number.isInteger(chunkNumber)) {
      throw new BadRequestError('Chunk number must be a non-negative integer', 'INVALID_CHUNK_NUMBER');
    }

    const sessionChunkDir = path.join(this.chunkDir, uploadId);
    await fs.promises.mkdir(sessionChunkDir, { recursive: true });

    const chunkPath = this.getChunkPath(uploadId, chunkNumber);
    const tempChunkPath = `${chunkPath}.part_${Date.now()}`;

    const writeStream = fs.createWriteStream(tempChunkPath);
    const hash = crypto.createHash('sha256');
    let size = 0;

    const inspector = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        size += buf.length;
        hash.update(buf);
        callback(null, buf);
      },
    });

    try {
      await new Promise<void>((resolve, reject) => {
        (stream as Readable)
          .pipe(inspector)
          .pipe(writeStream)
          .on('finish', () => resolve())
          .on('error', (err) => reject(err));
      });

      const checksum = hash.digest('hex');

      if (expectedChecksum && expectedChecksum !== checksum) {
        await fs.promises.unlink(tempChunkPath).catch(() => {});
        throw new ConflictError(
          `Chunk checksum mismatch: expected ${expectedChecksum} but calculated ${checksum}`,
          'CHUNK_CHECKSUM_MISMATCH'
        );
      }

      await fs.promises.rename(tempChunkPath, chunkPath);
      return { size, checksum };
    } catch (error) {
      await fs.promises.unlink(tempChunkPath).catch(() => {});
      throw error;
    }
  }

  /**
   * Checks if a specific temporary chunk file physically exists and is readable
   */
  async chunkExists(uploadId: string, chunkNumber: number): Promise<boolean> {
    if (!uploadId || typeof uploadId !== 'string' || uploadId.includes('..') || uploadId.includes('\0')) {
      return false;
    }
    try {
      const chunkPath = this.getChunkPath(uploadId, chunkNumber);
      await fs.promises.access(chunkPath, fs.constants.R_OK);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Deletes all temporary chunks for an upload session
   */
  async deleteChunks(uploadId: string): Promise<void> {
    if (!uploadId || typeof uploadId !== 'string' || uploadId.includes('..') || uploadId.includes('\0')) {
      return;
    }
    const sessionChunkDir = path.join(this.chunkDir, uploadId);
    try {
      await fs.promises.rm(sessionChunkDir, { recursive: true, force: true });
    } catch {
      // Ignore removal failure
    }
  }

  /**
   * Sequentially streams all verified chunks into MinIO object storage,
   * calculating the final SHA-256 checksum and size, then cleans up temporary chunks
   */
  async assembleChunks(
    uploadId: string,
    totalChunks: number,
    targetKey: string
  ): Promise<StorageUploadResult> {
    this.validateStorageKey(targetKey);

    // Verify all chunks exist before commencing assembly
    for (let i = 0; i < totalChunks; i++) {
      const chunkPath = this.getChunkPath(uploadId, i);
      try {
        await fs.promises.access(chunkPath, fs.constants.R_OK);
      } catch {
        throw new NotFoundError(`Missing chunk ${i} during assembly`, 'MISSING_CHUNK');
      }
    }

    const self = this;
    // Sequential generator stream reading chunk files one by one
    async function* streamChunks() {
      for (let i = 0; i < totalChunks; i++) {
        const chunkPath = self.getChunkPath(uploadId, i);
        const readStream = fs.createReadStream(chunkPath);
        for await (const chunk of readStream) {
          yield chunk;
        }
      }
    }

    const combinedStream = Readable.from(streamChunks());

    // Stream combined chunks directly into MinIO
    const uploadResult = await this.upload(targetKey, combinedStream);

    // Purge temporary chunk files
    await this.deleteChunks(uploadId);

    logger.info(
      { uploadId, totalChunks, targetKey, size: uploadResult.size, bucket: this.bucket },
      'Chunked upload assembled and uploaded to MinIO successfully'
    );

    return uploadResult;
  }
}
