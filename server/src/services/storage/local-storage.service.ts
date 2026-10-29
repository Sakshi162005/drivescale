import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { pipeline } from 'stream/promises';
import { Transform } from 'stream';
import {
  IStorageService,
  StorageMetadata,
  StorageUploadResult,
} from './storage.interface.js';
import { BadRequestError, NotFoundError } from '../../utils/errors.js';
import { logger } from '../../utils/logger.js';

export class LocalStorageService implements IStorageService {
  private readonly baseDir: string;

  constructor(baseDir?: string) {
    this.baseDir = baseDir
      ? path.resolve(baseDir)
      : path.resolve(process.env['STORAGE_LOCAL_DIR'] || path.join(process.cwd(), 'data', 'storage'));

    // Ensure base directory exists synchronously on initialization
    if (!fs.existsSync(this.baseDir)) {
      fs.mkdirSync(this.baseDir, { recursive: true });
    }
  }

  /**
   * Resolves storage key to absolute filesystem path with path traversal protection
   */
  public resolvePath(key: string): string {
    if (!key || typeof key !== 'string' || key.includes('\0')) {
      throw new BadRequestError('Invalid storage key format', 'INVALID_STORAGE_KEY');
    }

    // Reject any relative directory traversal markers
    if (key.includes('..')) {
      logger.warn({ key, baseDir: this.baseDir }, 'Path traversal attempt detected');
      throw new BadRequestError('Invalid storage key: path traversal detected', 'PATH_TRAVERSAL');
    }

    const resolvedPath = path.resolve(this.baseDir, key);

    // Verify resolved path stays strictly within baseDir
    if (!resolvedPath.startsWith(this.baseDir)) {
      logger.warn({ key, resolvedPath, baseDir: this.baseDir }, 'Path traversal attempt detected');
      throw new BadRequestError('Invalid storage key: path traversal detected', 'PATH_TRAVERSAL');
    }

    return resolvedPath;
  }

  /**
   * Streams data into local storage, computing SHA-256 checksum and total byte size
   */
  async upload(key: string, stream: NodeJS.ReadableStream): Promise<StorageUploadResult> {
    const filePath = this.resolvePath(key);
    const dir = path.dirname(filePath);

    await fs.promises.mkdir(dir, { recursive: true });

    const writeStream = fs.createWriteStream(filePath);
    const hash = crypto.createHash('sha256');
    let size = 0;

    const inspector = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        size += chunk.length;
        hash.update(chunk);
        callback(null, chunk);
      },
    });

    try {
      await pipeline(stream, inspector, writeStream);
      const checksum = hash.digest('hex');
      return { size, checksum };
    } catch (error) {
      // Clean up partially written file on error
      try {
        await fs.promises.unlink(filePath);
      } catch {
        // Ignore cleanup error
      }
      throw error;
    }
  }

  /**
   * Returns a readable stream for the stored file
   */
  async createReadStream(key: string): Promise<NodeJS.ReadableStream> {
    const filePath = this.resolvePath(key);

    try {
      await fs.promises.access(filePath, fs.constants.R_OK);
    } catch {
      throw new NotFoundError('Storage object not found', 'STORAGE_OBJECT_NOT_FOUND');
    }

    return fs.createReadStream(filePath);
  }

  /**
   * Reads entire file into a Buffer
   */
  async download(key: string): Promise<Buffer> {
    const filePath = this.resolvePath(key);

    try {
      return await fs.promises.readFile(filePath);
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new NotFoundError('Storage object not found', 'STORAGE_OBJECT_NOT_FOUND');
      }
      throw error;
    }
  }

  /**
   * Deletes the stored object
   */
  async delete(key: string): Promise<void> {
    const filePath = this.resolvePath(key);

    try {
      await fs.promises.unlink(filePath);
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error;
      }
    }
  }

  /**
   * Checks if the stored object exists
   */
  async exists(key: string): Promise<boolean> {
    const filePath = this.resolvePath(key);

    try {
      await fs.promises.access(filePath, fs.constants.F_OK);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Retrieves file size and last modified date
   */
  async getMetadata(key: string): Promise<StorageMetadata> {
    const filePath = this.resolvePath(key);

    try {
      const stats = await fs.promises.stat(filePath);
      return {
        size: stats.size,
        lastModified: stats.mtime,
      };
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new NotFoundError('Storage object not found', 'STORAGE_OBJECT_NOT_FOUND');
      }
      throw error;
    }
  }

  /**
   * Validates and returns the path to a session chunk file
   */
  private getChunkPath(uploadId: string, chunkNumber: number): string {
    if (!uploadId || typeof uploadId !== 'string' || uploadId.includes('..') || uploadId.includes('\0')) {
      throw new BadRequestError('Invalid upload session ID for chunk storage', 'INVALID_UPLOAD_ID');
    }
    return path.join(this.baseDir, 'chunks', uploadId, `chunk_${chunkNumber}`);
  }

  /**
   * Saves an incoming chunk stream for a given upload session
   */
  async saveChunk(uploadId: string, chunkNumber: number, stream: NodeJS.ReadableStream): Promise<StorageUploadResult> {
    const chunkPath = this.getChunkPath(uploadId, chunkNumber);
    const chunkDir = path.dirname(chunkPath);

    await fs.promises.mkdir(chunkDir, { recursive: true });

    // Write chunk to a temporary file first, then atomically rename to avoid partial writes
    const tempChunkPath = `${chunkPath}.tmp_${Date.now()}`;
    const writeStream = fs.createWriteStream(tempChunkPath);
    const hash = crypto.createHash('sha256');
    let size = 0;

    const inspector = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        size += chunk.length;
        hash.update(chunk);
        callback(null, chunk);
      },
    });

    try {
      await pipeline(stream, inspector, writeStream);
      await fs.promises.rename(tempChunkPath, chunkPath);
      const checksum = hash.digest('hex');
      return { size, checksum };
    } catch (error) {
      try {
        await fs.promises.unlink(tempChunkPath);
      } catch {
        // Ignore cleanup error
      }
      throw error;
    }
  }

  /**
   * Deletes all temporary chunks for an upload session
   */
  async deleteChunks(uploadId: string): Promise<void> {
    if (!uploadId || typeof uploadId !== 'string' || uploadId.includes('..') || uploadId.includes('\0')) {
      return;
    }
    const chunkDir = path.join(this.baseDir, 'chunks', uploadId);
    try {
      await fs.promises.rm(chunkDir, { recursive: true, force: true });
    } catch {
      // Ignore directory removal errors
    }
  }

  /**
   * Assembles all chunks in numerical order into targetKey using Node.js streams
   */
  async assembleChunks(uploadId: string, totalChunks: number, targetKey: string): Promise<StorageUploadResult> {
    const targetPath = this.resolvePath(targetKey);
    const targetDir = path.dirname(targetPath);

    await fs.promises.mkdir(targetDir, { recursive: true });

    const tempTargetPath = `${targetPath}.assembling_${Date.now()}`;
    const writeStream = fs.createWriteStream(tempTargetPath);
    const hash = crypto.createHash('sha256');
    let totalSize = 0;

    try {
      for (let i = 0; i < totalChunks; i++) {
        const chunkPath = this.getChunkPath(uploadId, i);
        try {
          await fs.promises.access(chunkPath, fs.constants.R_OK);
        } catch {
          throw new NotFoundError(`Missing chunk ${i} during assembly`, 'MISSING_CHUNK');
        }

        await new Promise<void>((resolve, reject) => {
          const readStream = fs.createReadStream(chunkPath);
          readStream.on('data', (chunk: Buffer | string) => {
            const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
            totalSize += buf.length;
            hash.update(buf);
            const canContinue = writeStream.write(buf);
            if (!canContinue) {
              readStream.pause();
              writeStream.once('drain', () => readStream.resume());
            }
          });
          readStream.on('end', () => resolve());
          readStream.on('error', (err) => reject(err));
        });
      }

      await new Promise<void>((resolve, reject) => {
        writeStream.end(() => resolve());
        writeStream.on('error', reject);
      });

      // Atomically replace targetPath with assembled file
      await fs.promises.rename(tempTargetPath, targetPath);

      // Clean up temporary chunks
      await this.deleteChunks(uploadId);

      const checksum = hash.digest('hex');
      return { size: totalSize, checksum };
    } catch (err) {
      try {
        await fs.promises.unlink(tempTargetPath);
      } catch {
        // Ignore
      }
      throw err;
    }
  }
}
