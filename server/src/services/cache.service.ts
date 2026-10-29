import { getRedisClient, isRedisReady } from '../config/redis.js';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';

export interface ICacheService {
  get<T>(key: string): Promise<T | null>;
  set(key: string, value: unknown, ttlSeconds?: number): Promise<void>;
  del(key: string): Promise<void>;
  delByPattern(pattern: string): Promise<void>;
}

export class CacheService implements ICacheService {
  private readonly defaultTtl: number;

  constructor(defaultTtl: number = env.REDIS_CACHE_TTL) {
    this.defaultTtl = defaultTtl;
  }

  /**
   * Retrieves and deserializes a cached item.
   * Returns null on cache miss, malformed data, or Redis outage (fail-safe).
   */
  async get<T>(key: string): Promise<T | null> {
    try {
      if (!isRedisReady()) {
        return null;
      }

      const client = getRedisClient();
      const raw = await client.get(key);
      if (!raw) {
        return null;
      }

      try {
        return JSON.parse(raw) as T;
      } catch (parseError) {
        logger.warn({ key, err: parseError }, 'Malformed cached JSON; purging corrupted key');
        // Delete malformed cached value to avoid repeated parse errors
        await this.del(key);
        return null;
      }
    } catch (error) {
      logger.warn(
        { key, err: error instanceof Error ? error.message : 'Unknown error' },
        'Redis cache get error; falling back to database'
      );
      return null;
    }
  }

  /**
   * Serializes and caches a value with an explicit TTL in seconds.
   * Fails gracefully without throwing on Redis outage.
   */
  async set(key: string, value: unknown, ttlSeconds: number = this.defaultTtl): Promise<void> {
    try {
      if (!isRedisReady()) {
        return;
      }

      const client = getRedisClient();
      const serialized = JSON.stringify(value);
      if (ttlSeconds > 0) {
        await client.set(key, serialized, 'EX', ttlSeconds);
      } else {
        await client.set(key, serialized);
      }
    } catch (error) {
      logger.warn(
        { key, err: error instanceof Error ? error.message : 'Unknown error' },
        'Redis cache set error (non-fatal)'
      );
    }
  }

  /**
   * Deletes a specific key from the cache.
   */
  async del(key: string): Promise<void> {
    try {
      if (!isRedisReady()) {
        return;
      }

      const client = getRedisClient();
      await client.del(key);
    } catch (error) {
      logger.warn(
        { key, err: error instanceof Error ? error.message : 'Unknown error' },
        'Redis cache del error (non-fatal)'
      );
    }
  }

  /**
   * Deletes all keys matching a glob-style pattern using non-blocking SCAN.
   */
  async delByPattern(pattern: string): Promise<void> {
    try {
      if (!isRedisReady()) {
        return;
      }

      const client = getRedisClient();
      let cursor = '0';

      do {
        const [nextCursor, keys] = await client.scan(cursor, 'MATCH', pattern, 'COUNT', 100);
        cursor = nextCursor;
        if (keys && keys.length > 0) {
          await client.del(...keys);
        }
      } while (cursor !== '0');
    } catch (error) {
      logger.warn(
        { pattern, err: error instanceof Error ? error.message : 'Unknown error' },
        'Redis cache delByPattern error (non-fatal)'
      );
    }
  }
}

/**
 * Standard key generators ensuring strict user isolation and clear namespaces
 */
export const CacheKeys = {
  // Folder listing for a given parent (null represents root)
  folderChildren: (userId: string, parentId: string | null = null) =>
    `drivescale:user:${userId}:folder:${parentId || 'root'}:children`,

  // Entire folder tree for a user
  folderTree: (userId: string) =>
    `drivescale:user:${userId}:folder:tree`,

  // Individual folder metadata
  folderDetail: (userId: string, folderId: string) =>
    `drivescale:user:${userId}:folder:${folderId}:meta`,

  // File listing scoped to folder and pagination
  fileList: (userId: string, folderId: string | null = null, page = 1, limit = 50) =>
    `drivescale:user:${userId}:files:${folderId || 'all'}:p${page}_l${limit}`,

  // Individual file metadata
  fileDetail: (userId: string, fileId: string) =>
    `drivescale:user:${userId}:file:${fileId}:meta`,

  // User storage statistics (storageUsed, storageQuota)
  userStorageStats: (userId: string) =>
    `drivescale:user:${userId}:storage:stats`,

  // Pattern matchers for user-scoped invalidation
  userAllFoldersPattern: (userId: string) =>
    `drivescale:user:${userId}:folder:*`,

  userAllFilesPattern: (userId: string) =>
    `drivescale:user:${userId}:files:*`,

  userAllPattern: (userId: string) =>
    `drivescale:user:${userId}:*`,
};

export const cacheService = new CacheService();

