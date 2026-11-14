import { Client } from 'minio';
import { env } from './env.js';
import { logger } from '../utils/logger.js';

let minioClientInstance: Client | null = null;

/**
 * Returns or creates the singleton MinIO client instance configured from environment
 */
export const getMinioClient = (): Client => {
  if (!minioClientInstance) {
    minioClientInstance = new Client({
      endPoint: env.MINIO_ENDPOINT,
      port: env.MINIO_PORT,
      useSSL: env.MINIO_USE_SSL,
      accessKey: env.MINIO_ACCESS_KEY,
      secretKey: env.MINIO_SECRET_KEY,
    });
  }
  return minioClientInstance;
};

export const minioClient: Client = getMinioClient();

/**
 * Checks if the configured bucket exists, and creates it idempotently if missing.
 * Handles concurrent initialization races and transient startup connection lags with bounded retries.
 */
export async function ensureBucketExists(
  client: Client = minioClient,
  bucketName: string = env.MINIO_BUCKET,
  retries = 5,
  retryDelayMs = 2000
): Promise<boolean> {
  let attempt = 0;
  while (attempt < retries) {
    attempt++;
    try {
      logger.info({ bucket: bucketName, attempt }, 'Verifying MinIO bucket status...');
      const exists = await client.bucketExists(bucketName);
      if (!exists) {
        logger.info({ bucket: bucketName }, 'Bucket does not exist; creating private bucket...');
        await client.makeBucket(bucketName);
        logger.info({ bucket: bucketName }, 'MinIO bucket created successfully');
      } else {
        logger.info({ bucket: bucketName }, 'MinIO bucket verified and ready');
      }
      return true;
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      if (
        errorMsg.includes('BucketAlreadyOwnedByYou') ||
        errorMsg.includes('BucketAlreadyExists')
      ) {
        logger.info({ bucket: bucketName }, 'Bucket already exists (concurrent creation race resolved)');
        return true;
      }

      logger.warn(
        { err: errorMsg, attempt, retries, bucket: bucketName },
        `MinIO bucket check failed on attempt ${attempt}/${retries}; retrying in ${retryDelayMs}ms...`
      );

      if (attempt >= retries) {
        logger.error({ err: errorMsg, bucket: bucketName }, 'MinIO bucket initialization failed after all retries');
        return false;
      }

      await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
    }
  }
  return false;
}

/**
 * Initializes object storage infrastructure at application startup
 */
export async function initStorage(client: Client = minioClient): Promise<boolean> {
  logger.info(
    {
      driver: env.STORAGE_DRIVER,
      endpoint: env.MINIO_ENDPOINT,
      port: env.MINIO_PORT,
      useSSL: env.MINIO_USE_SSL,
      bucket: env.MINIO_BUCKET,
    },
    'Initializing DriveScale storage infrastructure...'
  );

  if (env.STORAGE_DRIVER === 'local') {
    logger.info('Storage driver set to local filesystem');
    return true;
  }

  // MinIO initialization
  const initialized = await ensureBucketExists(client, env.MINIO_BUCKET);
  if (!initialized) {
    logger.warn('MinIO initialization incomplete; service will continue with degraded storage until MinIO is online');
    return false;
  }

  logger.info('MinIO object storage initialized and ready');
  return true;
}

/**
 * Returns the current health status of the storage backend for health checks
 */
export async function getStorageStatus(client: Client = minioClient): Promise<string> {
  if (env.STORAGE_DRIVER === 'local') {
    return 'connected';
  }
  try {
    const exists = await client.bucketExists(env.MINIO_BUCKET);
    return exists ? 'connected' : 'degraded';
  } catch {
    return 'disconnected';
  }
}
