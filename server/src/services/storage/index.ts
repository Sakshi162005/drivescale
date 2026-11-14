import { IStorageService } from './storage.interface.js';
import { LocalStorageService } from './local-storage.service.js';
import { MinioStorageService } from './minio-storage.service.js';
import { minioClient } from '../../config/storage.js';
import { env } from '../../config/env.js';

export * from './storage.interface.js';
export * from './local-storage.service.js';
export * from './minio-storage.service.js';

/**
 * Creates the storage service instance according to configured STORAGE_DRIVER
 */
export const createStorageService = (): IStorageService => {
  if (env.STORAGE_DRIVER === 'local') {
    return new LocalStorageService();
  }
  return new MinioStorageService(minioClient, env.MINIO_BUCKET);
};

let activeStorageService: IStorageService = createStorageService();

// Delegating singleton storage service instance (MinIO in Phase 12 / production)
export const storageService: IStorageService = {
  upload: (key, stream) => activeStorageService.upload(key, stream),
  createReadStream: (key) => activeStorageService.createReadStream(key),
  download: (key) => activeStorageService.download(key),
  delete: (key) => activeStorageService.delete(key),
  exists: (key) => activeStorageService.exists(key),
  getMetadata: (key) => activeStorageService.getMetadata(key),
  saveChunk: (uploadId, chunkNumber, stream, expectedChecksum) =>
    activeStorageService.saveChunk(uploadId, chunkNumber, stream, expectedChecksum),
  chunkExists: (uploadId, chunkNumber) => activeStorageService.chunkExists(uploadId, chunkNumber),
  deleteChunks: (uploadId) => activeStorageService.deleteChunks(uploadId),
  assembleChunks: (uploadId, totalChunks, targetKey) =>
    activeStorageService.assembleChunks(uploadId, totalChunks, targetKey),
};

/**
 * Helper to override active storage service (e.g. for testing)
 */
export const setStorageService = (service: IStorageService): void => {
  activeStorageService = service;
};

/**
 * Returns the underlying active storage service instance
 */
export const getActiveStorageService = (): IStorageService => {
  return activeStorageService;
};
